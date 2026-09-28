#!/usr/bin/env python3
"""Builds dist/proresmat.apk without the Android SDK or Gradle.

The standard toolchain (Gradle, aapt2, SDK platforms) downloads from dl.google.com. This script
needs only a JDK, Python 3 and three jars from Maven Central:
  - org.robolectric:android-all        Android framework classes to compile against
  - com.jakewharton.android.repackaged:dalvik-dx   Java bytecode -> DEX
  - com.android.tools.build:apksig     APK signing (v2) and verification
It encodes the binary AndroidManifest.xml and resources.arsc itself, zip-aligns stored entries,
and signs with a local keystore (android/keystore.p12, created on first run, never committed).

Usage:  npm run build && python3 android/build_apk.py
"""
import os
import shutil
import struct
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BUILD = os.path.join(HERE, 'build')
LIB = os.path.join(HERE, 'lib')
OUT = os.path.join(ROOT, 'dist', 'proresmat.apk')
WEB = os.path.join(ROOT, 'dist', 'proresmat-standalone.html')
PACKAGE = 'com.proresmat.healthconnect'
ANDROID_NS = 'http://schemas.android.com/apk/res/android'
MAVEN = 'https://repo1.maven.org/maven2/'
JARS = {
    'android-all.jar': 'org/robolectric/android-all/14-robolectric-10818077/android-all-14-robolectric-10818077.jar',
    'dalvik-dx.jar': 'com/jakewharton/android/repackaged/dalvik-dx/16.0.1/dalvik-dx-16.0.1.jar',
    'apksig.jar': 'com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar',
}

# android.R.attr IDs (from the API 34 framework) for every attribute the manifest uses.
ATTR_IDS = {
    'theme': 0x01010000, 'label': 0x01010001, 'icon': 0x01010002, 'name': 0x01010003,
    'exported': 0x01010010, 'configChanges': 0x0101001f, 'minSdkVersion': 0x0101020c,
    'versionCode': 0x0101021b, 'versionName': 0x0101021c, 'windowSoftInputMode': 0x0101022b,
    'targetSdkVersion': 0x01010270, 'allowBackup': 0x01010280, 'hardwareAccelerated': 0x010102d3,
    'supportsRtl': 0x010103af, 'usesCleartextTraffic': 0x010104ec,
}
INT_ATTRS = {'versionCode', 'minSdkVersion', 'targetSdkVersion'}
BOOL_ATTRS = {'exported', 'allowBackup', 'hardwareAccelerated', 'supportsRtl', 'usesCleartextTraffic'}
FLAG_ATTRS = {
    'configChanges': {'orientation': 0x80, 'keyboardHidden': 0x20, 'screenSize': 0x400, 'screenLayout': 0x100, 'uiMode': 0x200, 'keyboard': 0x10},
    'windowSoftInputMode': {'adjustResize': 0x10, 'adjustPan': 0x20, 'stateHidden': 0x2},
}
# Resources defined in our resources.arsc: package 0x7f, type 1 (drawable), entry 0 (icon).
ICON_PATH = 'res/drawable-nodpi-v4/icon.png'
RES_IDS = {'@drawable/icon': 0x7F010000}

TYPE_NULL, TYPE_REFERENCE, TYPE_STRING, TYPE_INT_DEC, TYPE_INT_HEX, TYPE_BOOLEAN = 0x00, 0x01, 0x03, 0x10, 0x11, 0x12


def log(msg):
    print(f'[apk] {msg}', flush=True)


def fetch_jars():
    os.makedirs(LIB, exist_ok=True)
    for name, path in JARS.items():
        dest = os.path.join(LIB, name)
        if os.path.exists(dest):
            continue
        log(f'downloading {name}')
        for attempt in range(6):
            try:
                with urllib.request.urlopen(MAVEN + path, timeout=300) as r, open(dest + '.part', 'wb') as f:
                    shutil.copyfileobj(r, f)
                os.replace(dest + '.part', dest)
                break
            except Exception as e:  # Maven Central rate-limits bursts (HTTP 429)
                if attempt == 5:
                    raise
                wait = 3 * (2 ** attempt)
                log(f'  retry in {wait}s ({e})')
                time.sleep(wait)


# ---------------------------------------------------------------- string pools
def string_pool(strings):
    """ResStringPool chunk, UTF-16 encoded."""
    offsets, data = [], b''
    for s in strings:
        offsets.append(len(data))
        enc = s.encode('utf-16-le')
        n = len(s.encode('utf-16-le')) // 2
        if n > 0x7FFF:
            raise ValueError('string too long')
        data += struct.pack('<H', n) + enc + b'\x00\x00'
    while len(data) % 4:
        data += b'\x00'
    header_size = 28
    strings_start = header_size + 4 * len(strings)
    size = strings_start + len(data)
    head = struct.pack('<HHIIIIII', 0x0001, header_size, size, len(strings), 0, 0, strings_start, 0)
    return head + b''.join(struct.pack('<I', o) for o in offsets) + data


# ---------------------------------------------------------------- binary XML
def encode_manifest(path):
    tree = ET.parse(path)
    root = tree.getroot()
    elements = list(root.iter())
    # Attribute names with resource IDs must come first in the pool, matching the resource map.
    res_names = []
    for el in elements:
        for key in el.attrib:
            if key.startswith('{' + ANDROID_NS + '}'):
                n = key.split('}')[1]
                if n not in ATTR_IDS:
                    raise SystemExit(f'unknown android attribute: {n}')
                if n not in res_names:
                    res_names.append(n)
    res_names.sort(key=lambda n: ATTR_IDS[n])
    pool = list(res_names)

    def idx(s):
        if s not in pool:
            pool.append(s)
        return pool.index(s)

    idx('android')
    idx(ANDROID_NS)
    body = b''
    line = 1
    body += struct.pack('<HHIIIII', 0x0100, 16, 24, line, 0xFFFFFFFF, idx('android'), idx(ANDROID_NS))

    def typed(name, value):
        if value.startswith('@'):
            if value not in RES_IDS:
                raise SystemExit(f'unknown resource {value}')
            return TYPE_REFERENCE, RES_IDS[value], 0xFFFFFFFF
        if name in INT_ATTRS:
            return TYPE_INT_DEC, int(value), 0xFFFFFFFF
        if name in BOOL_ATTRS:
            return TYPE_BOOLEAN, 0xFFFFFFFF if value == 'true' else 0, 0xFFFFFFFF
        if name in FLAG_ATTRS:
            bits = 0
            for part in value.split('|'):
                bits |= FLAG_ATTRS[name][part]
            return TYPE_INT_HEX, bits, 0xFFFFFFFF
        return TYPE_STRING, idx(value), idx(value)

    def walk(el):
        nonlocal body, line
        line += 1
        attrs = []
        for key, value in el.attrib.items():
            if key.startswith('{' + ANDROID_NS + '}'):
                n = key.split('}')[1]
                dtype, data, raw = typed(n, value)
                attrs.append((ATTR_IDS[n], idx(ANDROID_NS), idx(n), raw, dtype, data))
            else:
                attrs.append((0, 0xFFFFFFFF, idx(key), idx(value), TYPE_STRING, idx(value)))
        # The framework expects attributes ordered by resource ID.
        attrs.sort(key=lambda a: a[0])
        attr_bytes = b''.join(struct.pack('<IIIHBBI', ns, nm, raw, 8, 0, dt, d) for _, ns, nm, raw, dt, d in attrs)
        name_idx = idx(el.tag)
        start = struct.pack('<IIIIHHHHHH', line, 0xFFFFFFFF, 0xFFFFFFFF, name_idx, 20, 20, len(attrs), 0, 0, 0)
        chunk = start + attr_bytes
        body += struct.pack('<HHI', 0x0102, 16, 8 + len(chunk)) + chunk
        for child in el:
            walk(child)
        line += 1
        body += struct.pack('<HHIIIII', 0x0103, 16, 24, line, 0xFFFFFFFF, 0xFFFFFFFF, name_idx)

    walk(root)
    body += struct.pack('<HHIIIII', 0x0101, 16, 24, line + 1, 0xFFFFFFFF, idx('android'), idx(ANDROID_NS))
    sp = string_pool(pool)
    resmap = struct.pack('<HHI', 0x0180, 8, 8 + 4 * len(res_names)) + b''.join(struct.pack('<I', ATTR_IDS[n]) for n in res_names)
    content = sp + resmap + body
    return struct.pack('<HHI', 0x0003, 8, 8 + len(content)) + content


# ---------------------------------------------------------------- resources.arsc
def encode_resources():
    values = string_pool([ICON_PATH])
    type_strings = string_pool(['drawable'])
    key_strings = string_pool(['icon'])
    # typeSpec for type 1 with one entry
    type_spec = struct.pack('<HHIBBHI', 0x0202, 16, 20, 1, 0, 0, 1) + struct.pack('<I', 0)
    # ResTable_config (64 bytes): density = nodpi (0xFFFF), sdkVersion = 4
    config = bytearray(64)
    struct.pack_into('<I', config, 0, 64)
    struct.pack_into('<H', config, 14, 0xFFFF)
    struct.pack_into('<H', config, 24, 4)
    header_size = 20 + 64
    entries_start = header_size + 4
    entry = struct.pack('<HHI', 8, 0, 0) + struct.pack('<HBBI', 8, 0, TYPE_STRING, 0)
    type_chunk = struct.pack('<HHIBBHII', 0x0201, header_size, entries_start + len(entry), 1, 0, 0, 1, entries_start) + bytes(config) + struct.pack('<I', 0) + entry
    name = PACKAGE.encode('utf-16-le').ljust(256, b'\x00')
    pkg_header_size = 288
    type_strings_off = pkg_header_size
    key_strings_off = type_strings_off + len(type_strings)
    pkg_body = type_strings + key_strings + type_spec + type_chunk
    pkg = struct.pack('<HHII', 0x0200, pkg_header_size, pkg_header_size + len(pkg_body), 0x7F) + name + struct.pack('<IIIII', type_strings_off, 1, key_strings_off, 1, 0) + pkg_body
    content = values + pkg
    return struct.pack('<HHII', 0x0002, 12, 12 + len(content), 1) + content


# ---------------------------------------------------------------- aligned zip
def write_aligned_zip(path, entries):
    """entries: list of (name, bytes, stored). Stored entries are 4-byte aligned (like zipalign)."""
    with zipfile.ZipFile(path, 'w') as z:
        for name, data, stored in entries:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 0
            info.external_attr = 0
            if stored:
                info.compress_type = zipfile.ZIP_STORED
                offset = z.fp.tell()
                base = offset + 30 + len(name.encode('utf-8'))
                pad = (4 - (base + 6) % 4) % 4
                info.extra = struct.pack('<HHH', 0xD935, 2 + pad, 4) + b'\x00' * pad
            else:
                info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data, compresslevel=9 if not stored else None)


def check_alignment(path):
    with zipfile.ZipFile(path) as z, open(path, 'rb') as f:
        for info in z.infolist():
            if info.compress_type != zipfile.ZIP_STORED:
                continue
            f.seek(info.header_offset)
            h = f.read(30)
            n, e = struct.unpack('<HH', h[26:30])
            data_off = info.header_offset + 30 + n + e
            if data_off % 4:
                raise SystemExit(f'{info.filename} is not 4-byte aligned')


def run(cmd):
    subprocess.run(cmd, check=True)


def main():
    if not os.path.exists(WEB):
        raise SystemExit('Run `npm run build` first to create dist/proresmat-standalone.html')
    fetch_jars()
    shutil.rmtree(BUILD, ignore_errors=True)
    os.makedirs(os.path.join(BUILD, 'classes'))
    os.makedirs(os.path.join(BUILD, 'tools'))
    android_jar = os.path.join(LIB, 'android-all.jar')

    log('compiling Java')
    sources = [os.path.join(dp, f) for dp, _, fs in os.walk(os.path.join(HERE, 'src')) for f in fs if f.endswith('.java')]
    run(['javac', '-nowarn', '--release', '8', '-Xlint:-options', '-cp', android_jar, '-d', os.path.join(BUILD, 'classes')] + sources)
    log('converting to DEX')
    run(['java', '-cp', os.path.join(LIB, 'dalvik-dx.jar'), 'com.android.dx.command.Main', '--dex', '--min-sdk-version=24', '--output=' + os.path.join(BUILD, 'classes.dex'), os.path.join(BUILD, 'classes')])

    log('encoding manifest and resources')
    manifest = encode_manifest(os.path.join(HERE, 'AndroidManifest.xml'))
    resources = encode_resources()
    with open(os.path.join(HERE, 'res', 'icon.png'), 'rb') as f:
        icon = f.read()
    with open(WEB, 'rb') as f:
        web = f.read()
    with open(os.path.join(BUILD, 'classes.dex'), 'rb') as f:
        dex = f.read()

    unsigned = os.path.join(BUILD, 'unsigned.apk')
    write_aligned_zip(unsigned, [
        ('AndroidManifest.xml', manifest, False),
        ('classes.dex', dex, False),
        ('resources.arsc', resources, True),
        (ICON_PATH, icon, True),
        ('assets/www/index.html', web, False),
    ])
    check_alignment(unsigned)

    keystore = os.path.join(HERE, 'keystore.p12')
    password = os.environ.get('PRORESMAT_KEY_PASSWORD', 'proresmat-dev-key')
    if not os.path.exists(keystore):
        log('creating signing key (android/keystore.p12, keep it to sign future updates)')
        run(['keytool', '-genkeypair', '-keystore', keystore, '-storetype', 'PKCS12', '-storepass', password, '-keypass', password,
             '-alias', 'proresmat', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
             '-dname', 'CN=PRORESMAT Health Connect, O=PRORESMAT, C=GH'])

    log('signing')
    apksig = os.path.join(LIB, 'apksig.jar')
    run(['javac', '-nowarn', '-cp', apksig, '-d', os.path.join(BUILD, 'tools'), os.path.join(HERE, 'tools', 'SignApk.java')])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # apksig 2.3.0 (the last release on Maven Central) uses JDK-internal X.509 classes.
    jdk_exports = ['--add-exports', 'java.base/sun.security.x509=ALL-UNNAMED', '--add-exports', 'java.base/sun.security.pkcs=ALL-UNNAMED', '--add-exports', 'java.base/sun.security.util=ALL-UNNAMED']
    run(['java'] + jdk_exports + ['-cp', apksig + os.pathsep + os.path.join(BUILD, 'tools'), 'SignApk', unsigned, OUT, keystore, 'proresmat', password])
    check_alignment(OUT)
    log(f'done: {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} KB)')


if __name__ == '__main__':
    sys.exit(main())

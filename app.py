from flask import Flask, render_template, redirect, url_for, flash, request, jsonify
from flask_login import LoginManager, login_user, logout_user, current_user, login_required
from models import db, User, Post, Comment, Like, Friendship, Finding, Message, Notification
from forms import RegistrationForm, LoginForm, PostForm, FindingForm, ProfileForm, MessageForm, SearchForm
from werkzeug.urls import quote
from werkzeug.utils import secure_filename
from flask.sessions import SecureCookieSessionInterface
from PIL import Image  # For image resizing
import google.generativeai as genai
import os
import time
import random

app = Flask(__name__)
app.config['SECRET_KEY'] = 'archaeonet_super_secret_2025'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///archaeonet.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = os.path.join('static', 'Uploads')
app.config['SESSION_COOKIE_NAME'] = 'session'
app.config['SESSION_COOKIE_PARTITIONED'] = False
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5MB max file size
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Allowed file extensions for uploads
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}

# Gemini API Configuration
GEMINI_API_KEY = "AIzaSyA47TzgLL3O4-5K6LWUNu1trkWFCDkfDN4"
genai.configure(api_key=GEMINI_API_KEY)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def safe_gemini_api_call(func, *args, **kwargs):
    """Wrapper to handle rate limiting and retries for Gemini API"""
    max_retries = 3
    base_delay = 2  # seconds
    
    for attempt in range(max_retries):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            if "429" in str(e) and attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
                print(f"⏳ Gemini API rate limit hit. Retrying in {delay:.1f} seconds... (Attempt {attempt + 1}/{max_retries})")
                time.sleep(delay)
                continue
            else:
                raise e

db.init_app(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

class CustomSessionInterface(SecureCookieSessionInterface):
    def save_session(self, app, session, response):
        domain = self.get_cookie_domain(app) or app.config.get('SESSION_COOKIE_DOMAIN')
        path = self.get_cookie_path(app) or app.config.get('SESSION_COOKIE_PATH', '/')

        if not session:
            if session.modified:
                response.delete_cookie(
                    app.config['SESSION_COOKIE_NAME'],
                    domain=domain,
                    path=path
                )
            return

        httponly = self.get_cookie_httponly(app) or app.config.get('SESSION_COOKIE_HTTPONLY', True)
        secure = self.get_cookie_secure(app) or app.config.get('SESSION_COOKIE_SECURE', False)
        samesite = self.get_cookie_samesite(app) or app.config.get('SESSION_COOKIE_SAMESITE', None)
        expires = self.get_expiration_time(app, session)

        val = self.get_signing_serializer(app).dumps(dict(session))

        response.set_cookie(
            app.config['SESSION_COOKIE_NAME'],
            val,
            expires=expires,
            httponly=httponly,
            domain=domain,
            path=path,
            secure=secure,
            samesite=samesite
        )

app.session_interface = CustomSessionInterface()

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

def init_db():
    with app.app_context():
        db.create_all()

def add_notification(user_id, content):
    notif = Notification(content=content, user_id=user_id)
    db.session.add(notif)
    db.session.commit()

def are_mutual_friends(user_id, other_user_id):
    """check if 2 users are actually friends (both directions accepted)"""
    if user_id == other_user_id:
        return False
    
    # check if user1 has user2 as friend
    friendship1 = Friendship.query.filter_by(
        user_id=user_id, 
        friend_id=other_user_id, 
        accepted=True
    ).first()
    
    # check if user2 has user1 as friend
    friendship2 = Friendship.query.filter_by(
        user_id=other_user_id, 
        friend_id=user_id, 
        accepted=True
    ).first()
    
    # both need to exist for mutual friendship
    return friendship1 is not None and friendship2 is not None

def can_message_user(sender_id, receiver_id):
    """figure out if someone can send messages to another person"""
    if sender_id == receiver_id:
        return True  # can message yourself for testing i guess
    
    # check if theyre mutual friends first
    if are_mutual_friends(sender_id, receiver_id):
        return True
    
    # or if theyve already messaged before then its fine
    existing_convo = Message.query.filter(
        ((Message.sender_id == sender_id) & (Message.receiver_id == receiver_id)) |
        ((Message.sender_id == receiver_id) & (Message.receiver_id == sender_id))
    ).first()
    
    return existing_convo is not None

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    form = RegistrationForm()
    if form.validate_on_submit():
        if User.query.filter_by(email=form.email.data).first():
            flash('Email already registered.', 'error')
            return render_template('register.html', form=form)
        
        if User.query.filter_by(username=form.username.data).first():
            flash('Username already taken.', 'error')
            return render_template('register.html', form=form)
        
        user = User(username=form.username.data, email=form.email.data)
        user.set_password(form.password.data)
        db.session.add(user)
        db.session.commit()
        flash('Welcome to ArchaeoNet! Please log in.', 'success')
        return redirect(url_for('login'))
    return render_template('register.html', form=form)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('feed'))
    
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user and user.check_password(form.password.data):
            login_user(user)
            next_page = request.args.get('next')
            return redirect(next_page) if next_page else redirect(url_for('feed'))
        flash('Invalid email or password', 'error')
    return render_template('login.html', form=form)

@app.route('/logout')
@login_required
def logout():
    logout_user()
    flash('You have been logged out successfully.', 'success')
    return redirect(url_for('home'))

@app.route('/feed', methods=['GET', 'POST'])
@login_required
def feed():
    form = PostForm()
    search_form = SearchForm()
    
    if form.validate_on_submit():
        if not form.content.data or len(form.content.data.strip()) == 0:
            flash('Post content cannot be empty.', 'error')
            return redirect(url_for('feed'))
        
        # Create the post
        post = Post(
            content=form.content.data.strip(), 
            user_id=current_user.id
        )
        
        # Handle image uploads
        uploaded_images = []
        if 'post_images' in request.files:
            files = request.files.getlist('post_images')
            for file in files:
                if file and file.filename and allowed_file(file.filename):
                    filename = secure_filename(file.filename)
                    filename = f"post_{current_user.id}_{int(time.time())}_{filename}"
                    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                    
                    try:
                        # Resize and optimize image
                        img = Image.open(file)
                        if img.mode in ('RGBA', 'P'):
                            img = img.convert('RGB')
                        
                        # Resize to max 1200px width while maintaining aspect ratio
                        max_size = (1200, 1200)
                        img.thumbnail(max_size, Image.LANCZOS)
                        
                        img.save(filepath, 'JPEG', quality=85, optimize=True)
                        uploaded_images.append(filename)
                    except Exception as e:
                        print(f"Error processing image: {e}")
                        # Continue with other images even if one fails
        
        # Save image filenames to post
        if uploaded_images:
            post.images = ','.join(uploaded_images)
        
        db.session.add(post)
        db.session.commit()
        
        flash('Post created successfully!', 'success')
        return redirect(url_for('feed'))
    
    # Get posts from user and their friends
    friends = [f.friend_id for f in current_user.friends if f.accepted] + [current_user.id]
    posts = Post.query.filter(Post.user_id.in_(friends)).order_by(Post.timestamp.desc()).all()
    
    # Get unread notifications count
    notifications = Notification.query.filter_by(user_id=current_user.id, read=False).count()
    
    # Get recent messages
    messages = Message.query.filter(
        (Message.sender_id == current_user.id) | (Message.receiver_id == current_user.id)
    ).order_by(Message.timestamp.desc()).limit(5).all()
    
    return render_template('feed.html', posts=posts, post_form=form, search_form=search_form, 
                         notifications=notifications, messages=messages)

@app.route('/post/<int:post_id>/like', methods=['POST'])
@login_required
def like_post(post_id):
    post = Post.query.get_or_404(post_id)
    existing_like = Like.query.filter_by(user_id=current_user.id, post_id=post_id).first()
    
    if existing_like:
        # Unlike the post
        db.session.delete(existing_like)
        db.session.commit()
    else:
        # Like the post
        like = Like(user_id=current_user.id, post_id=post_id)
        db.session.add(like)
        db.session.commit()
        
        # Notify post author (if not self-like)
        if post.user_id != current_user.id:
            add_notification(post.user_id, f'{current_user.username} liked your post!')
    
    return jsonify({'likes': len(post.likes), 'liked': existing_like is None})

@app.route('/post/<int:post_id>/comment', methods=['POST'])
@login_required
def add_comment(post_id):
    post = Post.query.get_or_404(post_id)
    content = request.form.get('content', '').strip()
    
    if not content:
        flash('Comment cannot be empty.', 'error')
        return redirect(url_for('feed'))
    
    comment = Comment(content=content, user_id=current_user.id, post_id=post_id)
    db.session.add(comment)
    db.session.commit()
    
    # Notify post author (if not self-comment)
    if post.user_id != current_user.id:
        add_notification(post.user_id, f'{current_user.username} commented on your post!')
    
    flash('Comment added successfully!', 'success')
    return redirect(url_for('feed'))

@app.route('/profile/<username>')
@login_required
def profile(username):
    user = User.query.filter_by(username=username).first_or_404()
    posts = Post.query.filter_by(user_id=user.id).order_by(Post.timestamp.desc()).all()
    findings = Finding.query.filter_by(user_id=user.id).all()
    
    # Get recent messages for navbar
    messages = Message.query.filter(
        (Message.sender_id == current_user.id) | (Message.receiver_id == current_user.id)
    ).order_by(Message.timestamp.desc()).limit(5).all()
    
    return render_template('profile.html', user=user, posts=posts, findings=findings, messages=messages)

@app.route('/edit_profile', methods=['GET', 'POST'])
@login_required
def edit_profile():
    form = ProfileForm()
    
    if form.validate_on_submit():
        # Handle profile picture upload
        if form.profile_pic.data:
            file = form.profile_pic.data
            if file and allowed_file(file.filename):
                filename = secure_filename(file.filename)
                filename = f"{current_user.id}_profile_{filename}"
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                file.save(filepath)
                
                # Resize profile picture to 400x400
                try:
                    img = Image.open(filepath)
                    # Convert to RGB if necessary
                    if img.mode in ('RGBA', 'P'):
                        img = img.convert('RGB')
                    
                    # Resize maintaining aspect ratio
                    img.thumbnail((400, 400), Image.LANCZOS)
                    
                    # Save optimized version
                    img.save(filepath, 'JPEG', quality=85, optimize=True)
                    current_user.profile_pic = filename
                except Exception as e:
                    flash(f'Error processing profile image: {str(e)}', 'error')
                    return redirect(url_for('edit_profile'))
            else:
                flash('Invalid file type for profile picture. Please upload a PNG, JPG, JPEG, or GIF image.', 'error')
                return redirect(url_for('edit_profile'))
        
        # Handle banner image upload
        if form.banner_image.data:
            file = form.banner_image.data
            if file and allowed_file(file.filename):
                filename = secure_filename(file.filename)
                filename = f"{current_user.id}_banner_{filename}"
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                file.save(filepath)
                
                # Resize banner to optimal dimensions (1500x500 as suggested in HTML)
                try:
                    img = Image.open(filepath)
                    if img.mode in ('RGBA', 'P'):
                        img = img.convert('RGB')
                    
                    # Resize to recommended banner size
                    banner_size = (1500, 500)
                    img = img.resize(banner_size, Image.LANCZOS)
                    
                    img.save(filepath, 'JPEG', quality=85, optimize=True)
                    current_user.banner_image = filename
                except Exception as e:
                    flash(f'Error processing banner image: {str(e)}', 'error')
        
        # Handle site background image upload
        if form.site_bg_image.data:
            file = form.site_bg_image.data
            if file and allowed_file(file.filename):
                filename = secure_filename(file.filename)
                filename = f"{current_user.id}_sitebg_{filename}"
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                file.save(filepath)
                
                # Resize site background for optimal loading
                try:
                    img = Image.open(filepath)
                    if img.mode in ('RGBA', 'P'):
                        img = img.convert('RGB')
                    
                    # Resize to a reasonable size for backgrounds
                    bg_size = (1920, 1080)
                    img.thumbnail(bg_size, Image.LANCZOS)
                    
                    img.save(filepath, 'JPEG', quality=80, optimize=True)
                    current_user.site_bg_image = filename
                except Exception as e:
                    flash(f'Error processing background image: {str(e)}', 'error')
        
        # Update bio
        current_user.bio = form.bio.data.strip() if form.bio.data else None
        
        # Update banner settings
        current_user.banner_type = form.banner_type.data
        if form.banner_color.data:
            current_user.banner_color = form.banner_color.data
        if form.banner_gradient_start.data:
            current_user.banner_gradient_start = form.banner_gradient_start.data
        if form.banner_gradient_end.data:
            current_user.banner_gradient_end = form.banner_gradient_end.data
        
        # Update site background settings
        current_user.site_bg_type = form.site_bg_type.data
        if form.site_bg_color.data:
            current_user.site_bg_color = form.site_bg_color.data
        if form.site_bg_gradient_start.data:
            current_user.site_bg_gradient_start = form.site_bg_gradient_start.data
        if form.site_bg_gradient_end.data:
            current_user.site_bg_gradient_end = form.site_bg_gradient_end.data
        if form.site_bg_pattern.data:
            current_user.site_bg_pattern = form.site_bg_pattern.data
        
        # Update theme colors
        if form.theme_color.data:
            current_user.theme_color = form.theme_color.data
        if form.bg_color.data:
            current_user.bg_color = form.bg_color.data
        if form.text_color.data:
            current_user.text_color = form.text_color.data
        
        db.session.commit()
        flash('Profile updated successfully!', 'success')
        return redirect(url_for('profile', username=current_user.username))
    
    # Pre-populate form on GET request
    if request.method == 'GET':
        form.bio.data = current_user.bio
        
        # Banner settings
        form.banner_type.data = current_user.banner_type or 'gradient'
        form.banner_color.data = current_user.banner_color or '#3498db'
        form.banner_gradient_start.data = current_user.banner_gradient_start or '#3498db'
        form.banner_gradient_end.data = current_user.banner_gradient_end or '#9b59b6'
        
        # Site background settings
        form.site_bg_type.data = current_user.site_bg_type or 'color'
        form.site_bg_color.data = current_user.site_bg_color or '#f3f4f6'
        form.site_bg_gradient_start.data = current_user.site_bg_gradient_start or '#f3f4f6'
        form.site_bg_gradient_end.data = current_user.site_bg_gradient_end or '#e5e7eb'
        form.site_bg_pattern.data = current_user.site_bg_pattern or 'none'
        
        # Theme colors
        form.theme_color.data = current_user.theme_color or '#3498db'
        form.bg_color.data = current_user.bg_color or '#ecf0f1'
        form.text_color.data = current_user.text_color or '#2c3e50'
    
    return render_template('edit_profile.html', form=form)

@app.route('/search', methods=['GET', 'POST'])
@login_required
def search_users():
    form = SearchForm()
    results = []
    
    if form.validate_on_submit():
        query = form.query.data
        if query and query.strip():
            # Search for users by username (case-insensitive)
            results = User.query.filter(
                User.username.ilike(f'%{query.strip()}%')
            ).filter(User.id != current_user.id).all()
        else:
            flash('Please enter a search term.', 'error')
    
    return render_template('search.html', form=form, results=results)

@app.route('/friend_request/<int:user_id>', methods=['POST'])
@login_required
def send_friend_request(user_id):
    # cant friend yourself lol
    if user_id == current_user.id:
        flash('You cannot send a friend request to yourself.', 'error')
        return redirect(url_for('feed'))
    
    target_user = User.query.get_or_404(user_id)
    
    # check if already friends or request sent
    existing_friendship = Friendship.query.filter_by(
        user_id=current_user.id, friend_id=user_id
    ).first()
    
    # check reverse direction too
    reverse_friendship = Friendship.query.filter_by(
        user_id=user_id, friend_id=current_user.id
    ).first()
    
    # if they already sent you a request, accept it automatically
    if reverse_friendship and not reverse_friendship.accepted:
        reverse_friendship.accepted = True
        
        # create your side of the friendship too
        new_friendship = Friendship(
            user_id=current_user.id, 
            friend_id=user_id,
            accepted=True
        )
        db.session.add(new_friendship)
        db.session.commit()
        
        add_notification(user_id, f'{current_user.username} accepted your friend request!')
        flash('You are now friends!', 'success')
        return redirect(url_for('profile', username=target_user.username))
    
    if existing_friendship:
        flash('Friend request already sent or you are already friends.', 'error')
        return redirect(url_for('profile', username=target_user.username))
    
    # send new friend request
    friendship = Friendship(user_id=current_user.id, friend_id=user_id)
    db.session.add(friendship)
    db.session.commit()
    
    add_notification(user_id, f'{current_user.username} sent you a friend request!')
    flash('Friend request sent!', 'success')
    return redirect(url_for('profile', username=target_user.username))

@app.route('/accept_friend/<int:friendship_id>', methods=['POST'])
@login_required
def accept_friend(friendship_id):
    friendship = Friendship.query.get_or_404(friendship_id)
    
    # make sure youre the one receiving the request
    if friendship.friend_id != current_user.id:
        flash('Unauthorized action.', 'error')
        return redirect(url_for('feed'))
    
    # accept their request
    friendship.accepted = True
    
    # create your side of the friendship so its mutual
    reciprocal = Friendship(
        user_id=current_user.id,
        friend_id=friendship.user_id,
        accepted=True
    )
    db.session.add(reciprocal)
    db.session.commit()
    
    # tell them you accepted
    add_notification(friendship.user_id, f'{current_user.username} accepted your friend request!')
    flash('Friend request accepted!', 'success')
    return redirect(url_for('notifications'))

@app.route('/notifications')
@login_required
def notifications():
    # get all notifications
    notifs = Notification.query.filter_by(
        user_id=current_user.id
    ).order_by(Notification.timestamp.desc()).all()
    
    # get pending friend requests too
    pending_requests = Friendship.query.filter_by(
        friend_id=current_user.id,
        accepted=False
    ).all()
    
    # mark notifications as read
    for n in notifs:
        n.read = True
    db.session.commit()
    
    return render_template('notifications.html', 
                         notifications=notifs,
                         pending_requests=pending_requests)

@app.route('/messages/<int:user_id>', methods=['GET', 'POST'])
@login_required
def messages(user_id):
    other_user = User.query.get_or_404(user_id)
    
    # removed strict check - just let people message for now
    # can add back later if needed
    
    form = MessageForm()
    
    # handle sending message
    if request.method == 'POST':
        content = request.form.get('content', '').strip()
        
        if content:
            msg = Message(
                content=content,
                sender_id=current_user.id,
                receiver_id=user_id
            )
            db.session.add(msg)
            db.session.commit()
            
            # notify the other person
            if user_id != current_user.id:
                add_notification(user_id, f'New message from {current_user.username}!')
            
            flash('Message sent!', 'success')
            return redirect(url_for('messages', user_id=user_id))
        else:
            flash('Message cannot be empty.', 'error')
    
    # get all messages between these 2 users
    convo = Message.query.filter(
        ((Message.sender_id == current_user.id) & (Message.receiver_id == user_id)) |
        ((Message.sender_id == user_id) & (Message.receiver_id == current_user.id))
    ).order_by(Message.timestamp.asc()).all()
    
    return render_template('messages.html', form=form, convo=convo, other_user=other_user)

@app.route('/map')
@login_required
def map_view():
    findings = Finding.query.all()
    return render_template('map.html', findings=findings)

@app.route('/finding/create', methods=['GET', 'POST'])
@login_required
def create_finding():
    form = FindingForm()
    
    if form.validate_on_submit():
        latitude = form.latitude.data
        longitude = form.longitude.data
        description = form.description.data
        
        # Validate coordinates
        if not (-90 <= latitude <= 90):
            flash('Latitude must be between -90 and 90.', 'error')
            return render_template('create_finding.html', form=form)
        
        if not (-180 <= longitude <= 180):
            flash('Longitude must be between -180 and 180.', 'error')
            return render_template('create_finding.html', form=form)
        
        if not description or not description.strip():
            flash('Description cannot be empty.', 'error')
            return render_template('create_finding.html', form=form)
        
        # Create new finding
        finding = Finding(
            description=description.strip(),
            latitude=latitude,
            longitude=longitude,
            user_id=current_user.id
        )
        db.session.add(finding)
        db.session.commit()
        
        flash('Archaeological finding added successfully!', 'success')
        return redirect(url_for('map_view'))
    
    return render_template('create_finding.html', form=form)

@app.route('/chatbot', methods=['POST'])
@login_required
def chatbot():
    try:
        # Get request data
        data = request.get_json()
        user_message = data.get('message', '')
        history = data.get('history', [])
        
        print(f"[CHATBOT] Received message: {user_message}")
        
        if not user_message:
            return jsonify({'success': False, 'error': 'No message provided'})
        
        # Initialize the model with system instruction
        system_instruction = """You are ArchaeoBot, a witty and highly intelligent AI assistant for Xplora - an archaeological social network. 

PERSONALITY:
- Funny, pun-loving, and slightly sarcastic but always helpful
- Deep knowledge of archaeology, history, and anthropology
- Enthusiastic about ancient civilizations and discoveries
- Great at explaining complex archaeological concepts simply
- Can help with site navigation, research, and post scheduling

KEY RESPONSIBILITIES:
1. Site Navigation: Explain how to use Xplora features (feed, map, profile, search, etc.)
2. Archaeology Expertise: Explain concepts, methods, historical facts, research techniques
3. Research Assistance: Help formulate research questions, find resources, analyze findings
4. Post Scheduling: Guide users on planning and scheduling archaeological content
5. General Help: Answer questions about the platform and archaeology

STYLE GUIDELINES:
- Use archaeology-themed puns and humor
- Include relevant emojis occasionally 🏺🔍📜
- Be concise but thorough in explanations
- When unsure, admit it humorously
- Always maintain professional archaeological accuracy
- Reference real archaeological practices and ethics"""

        # Use a more stable model
        model_name = 'gemini-2.0-flash'  # More stable than experimental version
        
        def make_gemini_call():
            model = genai.GenerativeModel(
                model_name=model_name,
                system_instruction=system_instruction
            )
            
            # Start chat with history
            chat = model.start_chat(history=[])
            
            # Send message and get response
            response = chat.send_message(
                user_message,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.7,
                    max_output_tokens=1000,
                )
            )
            return response
        
        print(f"[CHATBOT] Sending to Gemini API (model: {model_name})...")
        
        # Use the safe API call wrapper with retry logic
        response = safe_gemini_api_call(make_gemini_call)
        
        print(f"[CHATBOT] Received response from Gemini")
        
        # Extract the response text
        bot_response = response.text
        
        print(f"[CHATBOT] Response: {bot_response[:100]}...")
        
        return jsonify({
            'success': True,
            'response': bot_response
        })
        
    except Exception as e:
        print(f"[CHATBOT ERROR] Type: {type(e).__name__}")
        print(f"[CHATBOT ERROR] Message: {str(e)}")
        import traceback
        print(f"[CHATBOT ERROR] Traceback:\n{traceback.format_exc()}")
        
        # Provide user-friendly error messages
        error_message = str(e)
        if "429" in error_message:
            user_message = "I'm currently experiencing high demand. Please try again in a moment! 🏺"
        elif "quota" in error_message.lower():
            user_message = "API quota exceeded. Please try again later or contact support. 🔍"
        else:
            user_message = f"Sorry, I encountered an error: {str(e)} 🏺"
        
        return jsonify({
            'success': False,
            'error': user_message
        })

@app.errorhandler(404)
def page_not_found(e):
    return render_template('404.html'), 404

@app.errorhandler(500)
def internal_error(e):
    db.session.rollback()
    return render_template('500.html'), 500

if __name__ == '__main__':
    init_db()
    app.run(
        debug=True,
        host='0.0.0.0',  # Allow connections from any IP
        port=5000,       # Default port
        threaded=True    # Handle multiple requests simultaneously
    )
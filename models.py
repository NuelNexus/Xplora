from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

db = SQLAlchemy()

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    bio = db.Column(db.Text, default='')
    profile_pic = db.Column(db.String(200), default='default.png')
    
    # Banner customization
    banner_type = db.Column(db.String(20), default='gradient')  # 'color', 'gradient', 'image'
    banner_color = db.Column(db.String(7), default='#3498db')
    banner_gradient_start = db.Column(db.String(7), default='#3498db')
    banner_gradient_end = db.Column(db.String(7), default='#9b59b6')
    banner_image = db.Column(db.String(200), nullable=True)
    
    # Site background customization
    site_bg_type = db.Column(db.String(20), default='color')  # 'color', 'gradient', 'image', 'pattern'
    site_bg_color = db.Column(db.String(7), default='#f3f4f6')
    site_bg_gradient_start = db.Column(db.String(7), default='#f3f4f6')
    site_bg_gradient_end = db.Column(db.String(7), default='#e5e7eb')
    site_bg_image = db.Column(db.String(200), nullable=True)
    site_bg_pattern = db.Column(db.String(20), default='none')  # 'dots', 'grid', etc.
    
    # Theme customization
    theme_color = db.Column(db.String(7), default='#3498db')  # Primary color
    bg_color = db.Column(db.String(7), default='#ecf0f1')     # Background color
    text_color = db.Column(db.String(7), default='#2c3e50')   # Text color
    
    # Ranking system
    rank_title = db.Column(db.String(50), default='Novice Explorer')
    rank_level = db.Column(db.Integer, default=1)
    
    posts = db.relationship('Post', backref='author', lazy=True, cascade='all, delete-orphan')
    comments = db.relationship('Comment', backref='author', lazy=True, cascade='all, delete-orphan')
    likes = db.relationship('Like', backref='user', lazy=True, cascade='all, delete-orphan')
    friends = db.relationship('Friendship', foreign_keys='Friendship.user_id', backref='user', lazy=True, cascade='all, delete-orphan')
    findings = db.relationship('Finding', backref='discoverer', lazy=True, cascade='all, delete-orphan')
    notifications = db.relationship('Notification', backref='user', lazy=True, cascade='all, delete-orphan')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def calculate_rank(self):
        """Calculate user rank based on findings count"""
        findings_count = len(self.findings)
        
        ranks = [
            (0, 1, 'Novice Explorer'),
            (5, 2, 'Amateur Archaeologist'),
            (10, 3, 'Field Researcher'),
            (20, 4, 'Senior Archaeologist'),
            (35, 5, 'Expert Excavator'),
            (50, 6, 'Master Archaeologist'),
            (75, 7, 'Distinguished Scholar'),
            (100, 8, 'Legendary Discoverer')
        ]
        
        for threshold, level, title in reversed(ranks):
            if findings_count >= threshold:
                self.rank_level = level
                self.rank_title = title
                return
    
    def get_rank_progress(self):
        """Get progress to next rank"""
        findings_count = len(self.findings)
        thresholds = [0, 5, 10, 20, 35, 50, 75, 100]
        
        if self.rank_level >= len(thresholds):
            return 100
        
        current_threshold = thresholds[self.rank_level - 1]
        next_threshold = thresholds[self.rank_level]
        
        progress = ((findings_count - current_threshold) / (next_threshold - current_threshold)) * 100
        return min(100, max(0, progress))


class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    
    # NEW: Image support for posts
    images = db.Column(db.String(500), nullable=True)  # Store comma-separated image filenames
    
    likes = db.relationship('Like', backref='post', lazy=True, cascade='all, delete-orphan')
    comments = db.relationship('Comment', backref='post', lazy=True, cascade='all, delete-orphan')

    def get_images(self):
        """Get list of image filenames"""
        if self.images:
            return self.images.split(',')
        return []


class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey('post.id'), nullable=False)
    parent_id = db.Column(db.Integer, db.ForeignKey('comment.id'), nullable=True)
    replies = db.relationship('Comment', backref=db.backref('parent', remote_side=[id]), lazy=True)


class Like(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey('post.id'), nullable=False)


class Friendship(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    friend_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    accepted = db.Column(db.Boolean, default=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    friend = db.relationship('User', foreign_keys=[friend_id])


class Finding(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    description = db.Column(db.Text, nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)


class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    sender = db.relationship('User', foreign_keys=[sender_id])
    receiver = db.relationship('User', foreign_keys=[receiver_id])


class Notification(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    read = db.Column(db.Boolean, default=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
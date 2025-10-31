# forms.py
from flask_wtf import FlaskForm
from flask_wtf.file import FileField, FileAllowed
from wtforms import StringField, PasswordField, TextAreaField, SubmitField, FloatField, SelectField
from wtforms.validators import DataRequired, Email, EqualTo, Length, Optional, Regexp

class RegistrationForm(FlaskForm):
    username = StringField('Username', validators=[DataRequired(), Length(min=3, max=64)])
    email = StringField('Email', validators=[DataRequired(), Email()])
    password = PasswordField('Password', validators=[DataRequired()])
    confirm_password = PasswordField('Confirm Password', validators=[DataRequired(), EqualTo('password')])
    submit = SubmitField('Register')

class LoginForm(FlaskForm):
    email = StringField('Email', validators=[DataRequired(), Email()])
    password = PasswordField('Password', validators=[DataRequired()])
    submit = SubmitField('Login')

class PostForm(FlaskForm):
    content = TextAreaField('What did you discover today?', validators=[DataRequired()])
    submit = SubmitField('Post')

class FindingForm(FlaskForm):
    description = TextAreaField('Finding Description', validators=[DataRequired()])
    latitude = FloatField('Latitude', validators=[DataRequired()])
    longitude = FloatField('Longitude', validators=[DataRequired()])
    submit = SubmitField('Add to Map')

class ProfileForm(FlaskForm):
    bio = TextAreaField('Bio', validators=[Length(max=500)])
    profile_pic = FileField('Update Profile Picture', validators=[FileAllowed(['jpg', 'png', 'jpeg', 'gif'])])
    
    # Banner customization
    banner_type = SelectField('Banner Type', choices=[('color', 'Solid Color'), ('gradient', 'Gradient'), ('image', 'Upload Image')], default='gradient')
    banner_color = StringField('Banner Color', validators=[Optional(), Regexp(r'^#[0-9a-fA-F]{6}$', message='Invalid hex color (e.g., #RRGGBB)')])
    banner_gradient_start = StringField('Gradient Start Color', validators=[Optional(), Regexp(r'^#[0-9a-fA-F]{6}$', message='Invalid hex color')])
    banner_gradient_end = StringField('Gradient End Color', validators=[Optional(), Regexp(r'^#[0-9a-fA-F]{6}$', message='Invalid hex color')])
    banner_image = FileField('Banner Image (Recommended: 2560x1440)', validators=[FileAllowed(['jpg', 'png', 'jpeg', 'gif'])])

    # Site background customization
    site_bg_type = SelectField('Site Background Type', choices=[('color', 'Solid Color'), ('gradient', 'Gradient'), ('image', 'Upload Image'), ('pattern', 'Pattern')], default='color')
    site_bg_color = StringField('Site Background Color', validators=[Optional(), Regexp(r'^#[0-9a-fA-F]{6}$', message='Invalid hex color')])
    site_bg_gradient_start = StringField('Site Gradient Start', validators=[Optional(), Regexp(r'^#[0-9a-fA-F]{6}$', message='Invalid hex color')])
    site_bg_gradient_end = StringField('Site Gradient End', validators=[Optional(), Regexp(r'^#[0-9a-fA-F]{6}$', message='Invalid hex color')])
    site_bg_image = FileField('Site Background Image', validators=[FileAllowed(['jpg', 'png', 'jpeg', 'gif'])])
    site_bg_pattern = SelectField('Background Pattern', choices=[
        ('none', 'None'),
        ('dots', 'Dots'),
        ('grid', 'Grid'),
        ('diagonal', 'Diagonal Lines'),
        ('waves', 'Waves'),
        ('bricks', 'Bricks'),
        ('zigzag', 'Zigzag')
    ], default='none')
    
    # Theme colors
    theme_color = StringField('Theme Color', validators=[Optional(), Regexp(r'^#[0-9a-fA-F]{6}$', message='Invalid hex color')])
    bg_color = StringField('Background Color', validators=[Optional(), Regexp(r'^#[0-9a-fA-F]{6}$', message='Invalid hex color')])
    text_color = StringField('Text Color', validators=[Optional(), Regexp(r'^#[0-9a-fA-F]{6}$', message='Invalid hex color')])
    
    submit = SubmitField('Update Profile')

class MessageForm(FlaskForm):
    content = TextAreaField('Message', validators=[DataRequired(), Length(min=1, max=1000)])
    submit = SubmitField('Send')

class SearchForm(FlaskForm):
    query = StringField('Search Users', validators=[DataRequired()])
    submit = SubmitField('Search')
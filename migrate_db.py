# create_migration.py
from app import app, db
from models import Post

def migrate_database():
    with app.app_context():
        # Add the images column to the post table
        from sqlalchemy import text
        
        try:
            # Check if the column already exists
            result = db.session.execute(text("PRAGMA table_info(post)"))
            columns = [row[1] for row in result]
            
            if 'images' not in columns:
                print("Adding images column to post table...")
                db.session.execute(text("ALTER TABLE post ADD COLUMN images VARCHAR(500)"))
                db.session.commit()
                print("Migration completed successfully!")
            else:
                print("Images column already exists.")
                
        except Exception as e:
            print(f"Migration error: {e}")
            db.session.rollback()

if __name__ == '__main__':
    migrate_database()
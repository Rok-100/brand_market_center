"""The local edition explicitly uses SQLite; production configuration is separate."""
import os
if os.getenv('LOCAL_DEV_MODE') == '1':
    from .local_database import *
else:
    from .database_mysql import *

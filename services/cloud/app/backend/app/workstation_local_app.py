"""Local integration of the explicit migrated workstation bridge."""
from .remix_local_app import app
from .remix_workstation import install
install(app)

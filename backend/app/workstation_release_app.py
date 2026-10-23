"""Production entry point layered on the current material release."""
from .material_release_app import app
from .remix_workstation import install
install(app)

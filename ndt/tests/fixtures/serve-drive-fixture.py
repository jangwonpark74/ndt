"""Start the integrated application with explicitly seeded, disposable DM examples."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.dm.dm_model import initialize
from backend.dm.demo import seed
from backend import server

if __name__ == '__main__':
    registry = Path(sys.argv[sys.argv.index('--dm-db')+1])
    initialize(registry)
    seed(registry)
    if '--field-fixtures' in sys.argv:
        import importlib.util
        spec=importlib.util.spec_from_file_location('field_ui_inputs',Path(__file__).with_name('field-inputs.py'))
        fields=importlib.util.module_from_spec(spec);spec.loader.exec_module(fields)
        large='--large-field-fixture' in sys.argv
        fields.seed_field_tests(registry,large=large);sys.argv.remove('--field-fixtures')
        if large:sys.argv.remove('--large-field-fixture')
    sys.exit(server.main())

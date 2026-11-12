"""Start the integrated application with explicitly seeded, disposable DM examples."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dm.dm_model import initialize
from dm.demo import seed
import server

if __name__ == '__main__':
    registry = Path(sys.argv[sys.argv.index('--dm-db')+1])
    initialize(registry)
    seed(registry)
    sys.exit(server.main())

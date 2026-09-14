from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("k-leo-orbit-designer")
except PackageNotFoundError:  # pragma: no cover - only hit when run outside an installed package
    __version__ = "0.0.0+unknown"

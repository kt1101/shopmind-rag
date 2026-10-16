from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Product:
    product_id: str
    title: str
    description: str
    brand: str | None
    category: str | None
    attributes: dict[str, str]
    image_paths: tuple[str, ...]
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def main_image_path(self) -> str | None:
        return self.image_paths[0] if self.image_paths else None

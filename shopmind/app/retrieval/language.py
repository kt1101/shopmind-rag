"""Small catalog vocabulary for lexical search, independent of evaluation labels.

Aliases translate everyday Vietnamese product/color terms and common European
color metadata. Unknown words and literal identifiers pass through unchanged.
"""
from __future__ import annotations

import re

CATEGORY_ALIASES = {
    "đồ dùng phòng ngủ và phòng tắm": "home_bed_and_bath", "bed and bath products": "home_bed_and_bath",
    "vỏ bọc nội thất": "furniture_cover", "furniture covers": "furniture_cover",
    "tranh trang trí tường": "wall_art", "wall art": "wall_art",
    "đồ dùng thú cưng": "pet_supplies", "pet supplies": "pet_supplies",
    "đồ dùng thể thao": "sporting_goods", "sporting goods": "sporting_goods",
    "dụng cụ viết": "writing_instrument", "writing instruments": "writing_instrument",
    "cốc uống nước": "drinking_cup", "drinking cups": "drinking_cup",
    "đồ dùng nhà bếp": "kitchen", "kitchen products": "kitchen",
    "hàng tạp hóa": "grocery", "groceries": "grocery",
    "ga trải giường": "flat_sheet", "flat sheets": "flat_sheet",
    "dép xăng đan": "sandal", "sandals": "sandal",
    "túi tote": "tote_bag", "tote bags": "tote_bag", "túi xách": "handbag", "handbags": "handbag",
    "giày bốt": "boot", "boots": "boot", "đầu giường": "headboard", "headboards": "headboard",
    "ghế đôn": "ottoman", "ottomans": "ottoman", "ghế sofa": "sofa", "sofas": "sofa",
    "giường": "bed", "beds": "bed", "gối": "pillow", "pillows": "pillow",
    "kệ": "shelf", "shelves": "shelf", "lọ": "jar", "jars": "jar",
    "thảm": "rug", "rugs": "rug", "dụng cụ": "tools", "hành lý": "luggage",
    "va li": "suitcase", "suitcases": "suitcase", "giày": "shoes",
}
COLOR_ALIASES = {
    "black": ("đen", "nero", "noir", "schwarz", "negro"),
    "white": ("trắng", "bianco", "blanc", "weiß", "weiss", "blanco"),
    "red": ("đỏ", "rosso", "rouge", "rot", "rojo"),
    "blue": ("xanh dương", "blu", "bleu", "blau", "azul"),
    "gray": ("xám", "grey", "grigio", "gris", "grau"),
    "green": ("xanh lá", "verde", "vert", "grün", "gruen"),
    "pink": ("hồng", "rosa", "rose", "roze"),
    "beige": ("be",), "navy blue": ("xanh hải quân", "navy",),
    "multicolor": ("nhiều màu", "multicolour", "multicoloured", "multicolored", "mehrfarbig"),
}
_TRANSLATIONS = {**CATEGORY_ALIASES, **{alias: color for color, aliases in COLOR_ALIASES.items() for alias in aliases}}
_PATTERN = re.compile(r"(?<!\w)(" + "|".join(re.escape(word) for word in sorted(_TRANSLATIONS,key=len,reverse=True)) + r")(?!\w)", re.IGNORECASE)


def normalize_lexical_query(query: str) -> str:
    # Identifiers and brand punctuation stay literal; only the leading request verb is removed.
    result = re.sub(r"^(find|tìm)\s+", "", query, flags=re.IGNORECASE)
    result = _PATTERN.sub(lambda match: _TRANSLATIONS[match.group().casefold()], result)
    return re.sub(r"(?<!\w)(from|in|của|màu)(?!\w)", " ", result, flags=re.IGNORECASE).strip()


def catalog_color_terms(color: str) -> str:
    value = color.strip().casefold()
    for canonical, aliases in COLOR_ALIASES.items():
        if value in (canonical, *aliases):
            return canonical
    return ""

"""Freeze metadata-grounded bilingual retrieval predicates; no human labels implied."""
from __future__ import annotations

import argparse
import hashlib
import json
import random
from collections import Counter, defaultdict
from pathlib import Path


# These are fixed query phrases, not translations inferred from product titles.
CATEGORY_ALIASES = {
    "SHOES": ("shoes", "giày"), "SANDAL": ("sandals", "dép xăng đan"),
    "BOOT": ("boots", "giày bốt"), "CELLULAR_PHONE_CASE": ("phone cases", "ốp điện thoại"),
    "CHAIR": ("chairs", "ghế"), "TABLE": ("tables", "bàn"),
    "SOFA": ("sofas", "ghế sofa"), "RUG": ("rugs", "thảm"),
    "HOME_BED_AND_BATH": ("bed and bath products", "đồ dùng phòng ngủ và phòng tắm"),
    "HOME_FURNITURE_AND_DECOR": ("home furniture and decor", "đồ nội thất và trang trí nhà"),
    "HOME": ("home products", "đồ dùng gia đình"),
    "HAT": ("hats", "mũ"), "HANDBAG": ("handbags", "túi xách"),
    "BACKPACK": ("backpacks", "ba lô"), "SUITCASE": ("suitcases", "va li"),
    "LUGGAGE": ("luggage", "hành lý"), "WALLET": ("wallets", "ví"),
    "TOTE_BAG": ("tote bags", "túi tote"), "UMBRELLA": ("umbrellas", "ô"),
    "HEADPHONES": ("headphones", "tai nghe"), "LAMP": ("lamps", "đèn"),
    "LIGHT_BULB": ("light bulbs", "bóng đèn"), "LIGHT_FIXTURE": ("light fixtures", "bộ đèn"),
    "WALL_ART": ("wall art", "tranh trang trí tường"), "PILLOW": ("pillows", "gối"),
    "FLAT_SHEET": ("flat sheets", "ga trải giường"), "BED": ("beds", "giường"),
    "HEADBOARD": ("headboards", "đầu giường"), "SHELF": ("shelves", "kệ"),
    "OTTOMAN": ("ottomans", "ghế đôn"), "STOOL_SEATING": ("stools", "ghế đẩu"),
    "BEAN_BAG_CHAIR": ("bean bag chairs", "ghế túi đậu"),
    "FURNITURE_COVER": ("furniture covers", "vỏ bọc nội thất"),
    "HOME_MIRROR": ("mirrors", "gương"), "DRINKING_CUP": ("drinking cups", "cốc uống nước"),
    "BOTTLE": ("bottles", "chai"), "JAR": ("jars", "lọ"),
    "PLANTER": ("planters", "chậu cây"), "CLOCK": ("clocks", "đồng hồ"),
    "HARDWARE_HANDLE": ("hardware handles", "tay nắm"), "STORAGE_HOOK": ("storage hooks", "móc treo"),
    "GROCERY": ("groceries", "hàng tạp hóa"), "COFFEE": ("coffee", "cà phê"),
    "PET_SUPPLIES": ("pet supplies", "đồ dùng thú cưng"),
    "OFFICE_PRODUCTS": ("office products", "đồ dùng văn phòng"),
    "WRITING_INSTRUMENT": ("writing instruments", "dụng cụ viết"),
    "SPORTING_GOODS": ("sporting goods", "đồ dùng thể thao"),
    "TOOLS": ("tools", "dụng cụ"), "KITCHEN": ("kitchen products", "đồ dùng nhà bếp"),
    "BEAUTY": ("beauty products", "sản phẩm làm đẹp"),
}
COLOR_ALIASES = {
    "black": {"en": "black", "vi": "đen", "metadata_values": ["black", "noir", "negro", "nero", "zwart", "schwarz", "काला"]},
    "white": {"en": "white", "vi": "trắng", "metadata_values": ["white", "blanco", "blanc", "bianco", "wit", "weiß", "ホワイト"]},
    "gray": {"en": "gray", "vi": "xám", "metadata_values": ["gray", "grey", "gris", "grigio", "grau"]},
    "blue": {"en": "blue", "vi": "xanh dương", "metadata_values": ["blue", "bleu", "azul", "blu", "blauw", "blau", "नीला"]},
    "navy": {"en": "navy blue", "vi": "xanh hải quân", "metadata_values": ["navy", "navy blue", "blue navy", "bleu marine"]},
    "red": {"en": "red", "vi": "đỏ", "metadata_values": ["red", "rouge", "rojo", "rosso", "rot", "rood"]},
    "brown": {"en": "brown", "vi": "nâu", "metadata_values": ["brown", "bruin", "braun", "marron", "marrón", "marrone", "भूरा"]},
    "beige": {"en": "beige", "vi": "be", "metadata_values": ["beige"]},
    "green": {"en": "green", "vi": "xanh lá", "metadata_values": ["green", "vert", "verde", "groen", "grün"]},
    "yellow": {"en": "yellow", "vi": "vàng", "metadata_values": ["yellow", "jaune", "amarillo", "giallo", "gelb", "geel"]},
    "pink": {"en": "pink", "vi": "hồng", "metadata_values": ["pink", "rose", "rosa", "roze"]},
    "orange": {"en": "orange", "vi": "cam", "metadata_values": ["orange", "naranja", "arancione"]},
    "silver": {"en": "silver", "vi": "bạc", "metadata_values": ["silver", "silber", "argent", "argento"]},
    "gold": {"en": "gold", "vi": "vàng kim", "metadata_values": ["gold", "or", "oro"]},
    "clear": {"en": "clear", "vi": "trong suốt", "metadata_values": ["clear", "transparent", "クリア"]},
    "multicolor": {"en": "multicolor", "vi": "nhiều màu", "metadata_values": ["multicolor", "multi-colored", "multi"]},
}


def _json_bytes(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def build_accuracy_benchmark(products_path: str | Path, output_dir: str | Path, *, seed: int = 42) -> Path:
    products_path, output_dir = Path(products_path), Path(output_dir)
    products = [json.loads(line) for line in products_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    seen = set()
    for product in products:
        product_id = product.get("product_id")
        if not isinstance(product_id, str) or not product_id.strip():
            raise ValueError("product_id must be a nonempty string")
        if product_id in seen:
            raise ValueError(f"duplicate product_id: {product_id}")
        seen.add(product_id)
    products.sort(key=lambda product: product["product_id"])

    # Reused images can identify variants or placeholders across category labels.
    # Exclude entire ambiguous categories, never individual predicate positives.
    image_groups = defaultdict(list)
    for product in products:
        image_id = product.get("metadata", {}).get("main_image_id")
        if image_id:
            image_groups[image_id].append(product)
    ambiguous = {image_id: rows for image_id, rows in image_groups.items() if len({row["category"] for row in rows}) > 1}
    excluded_categories = sorted({row["category"] for rows in ambiguous.values() for row in rows})
    excluded_product_ids = sorted(product["product_id"] for product in products if product["category"] in excluded_categories)
    supported = sorted((set(CATEGORY_ALIASES) & {product["category"] for product in products}) - set(excluded_categories))
    rng = random.Random(seed)
    shuffled = supported.copy()
    rng.shuffle(shuffled)
    dev_count = int(len(shuffled) * 0.7)
    category_splits = {category: "dev" if index < dev_count else "holdout" for index, category in enumerate(shuffled)}

    candidates = defaultdict(list)
    for category in supported:
        rows = [product for product in products if product["category"] == category]
        brands = sorted({product.get("brand") for product in rows if isinstance(product.get("brand"), str) and product["brand"].strip()})
        for kind in ("category_brand", "category_color", "category_brand_color"):
            for brand in brands if "brand" in kind else [None]:
                for color in sorted(COLOR_ALIASES) if "color" in kind else [None]:
                    positives = [product["product_id"] for product in rows if (brand is None or product.get("brand") == brand) and (color is None or product.get("attributes", {}).get("color", "").strip().casefold() in COLOR_ALIASES[color]["metadata_values"])]
                    if not 1 <= len(positives) <= 20:
                        continue
                    predicate = {"kind": kind, "category": category}
                    if brand is not None:
                        predicate["brand"] = brand
                    if color is not None:
                        predicate["color"] = color
                    candidates[kind].append((predicate, positives))

    queries, qrels, predicates = [], [], {}
    used_text = set()
    for kind in ("category_brand", "category_color", "category_brand_color"):
        rng.shuffle(candidates[kind])
        selected = 0
        for predicate, positives in candidates[kind]:
            category = predicate["category"]
            en_category, vi_category = CATEGORY_ALIASES[category]
            color = COLOR_ALIASES.get(predicate.get("color"))
            brand = predicate.get("brand")
            en = f"Find {en_category}" + (f" in {color['en']}" if color else "") + (f" from {brand}" if brand else "") + "."
            vi = f"Tìm {vi_category}" + (f" màu {color['vi']}" if color else "") + (f" của {brand}" if brand else "") + "."
            if en in used_text or vi in used_text:
                continue
            intent_id = f"predicate_{len(predicates) + 1:03d}"
            predicates[intent_id] = predicate
            for language, text in (("en", en), ("vi", vi)):
                query_id = f"{intent_id}_{language}"
                queries.append({"query_id": query_id, "query": text, "query_type": "text", "group": kind, "language": language, "split": category_splits[category], "intent_id": intent_id})
                qrels.extend({"query_id": query_id, "product_id": product_id, "relevance": 1} for product_id in positives)
                used_text.add(text)
            selected += 1
            if selected == 20:
                break

    exact_count = 0
    # Split-balanced probes (28 dev, 12 holdout) sampled after categories split.
    for split, limit in (("dev", 28), ("holdout", 12)):
        pool = [product for product in products if category_splits.get(product["category"]) == split]
        rng.shuffle(pool)
        for product in pool[:limit]:
            exact_count += 1
            intent_id = f"exact_{exact_count:03d}"
            predicates[intent_id] = {"kind": "exact_id", "category": product["category"], "product_id": product["product_id"]}
            queries.append({"query_id": intent_id, "query": product["product_id"], "query_type": "text", "group": "exact_id", "language": None, "split": split, "intent_id": intent_id})
            qrels.append({"query_id": intent_id, "product_id": product["product_id"], "relevance": 1})

    output_dir.mkdir(parents=True, exist_ok=True)
    hashes = {"corpus": hashlib.sha256(products_path.read_bytes()).hexdigest()}
    for filename, rows in (("queries.jsonl", queries), ("qrels.jsonl", qrels)):
        content = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows).encode("utf-8")
        (output_dir / filename).write_bytes(content)
        hashes[filename] = hashlib.sha256(content).hexdigest()
    positive_counts = Counter(row["query_id"] for row in qrels)
    manifest = {
        "schema_version": 1, "seed": seed, "label_status": "metadata_grounded", "hashes": hashes,
        "split_rule": "Sort supported categories; random.Random(seed).shuffle; floor(0.7*N) dev, remainder holdout; split before selecting any predicates or exact IDs.",
        "selection_rule": "Seeded shuffle within each predicate kind, take up to 20 unique English/Vietnamese pairs per kind; nonempty complete positives <=20. Exact IDs: up to28 dev and12 holdout.",
        "predicate_rule": "Exact category and exact brand equality; color is exact stripped casefolded metadata membership in fixed alias list. Evaluate over full corpus; no positive sampling.",
        "category_splits": dict(sorted(category_splits.items())),
        "aliases": {"categories": {key: {"en": value[0], "vi": value[1]} for key, value in sorted(CATEGORY_ALIASES.items())}, "colors": COLOR_ALIASES},
        "predicates": predicates, "positive_counts": dict(sorted(positive_counts.items())),
        "recall_at_10_ceiling": {key: min(10, count) / count for key, count in sorted(positive_counts.items())},
        "counts": {"corpus_products": len(products), "corpus_categories": len({product["category"] for product in products}), "supported_categories": len(supported), "supported_products": sum(product["category"] in supported for product in products), "queries": len(queries), "qrels": len(qrels), "predicate_groups": len(predicates) - exact_count, "exact_id_probes": exact_count, "queries_by_group": dict(sorted(Counter(row["group"] for row in queries).items())), "queries_by_split": dict(sorted(Counter(row["split"] for row in queries).items())), "categories_by_split": dict(sorted(Counter(category_splits.values()).items()))},
        "exclusions": {"rule": "Exclude all categories sharing any main_image_id across category labels; identities may be variants or ambiguous placeholders.", "categories": excluded_categories, "products_in_excluded_categories": len(excluded_product_ids), "product_ids": excluded_product_ids, "product_ids_sha256": hashlib.sha256(_json_bytes(excluded_product_ids)).hexdigest(), "cross_category_image_groups": {image_id: sorted(row["product_id"] for row in rows) for image_id, rows in sorted(ambiguous.items())}},
        "limitations": ["Metadata-grounded labels, never human reviewed semantic relevance.", "Only fixed supported category/color aliases are covered; missing, compound and ambiguous colors are excluded from color predicates.", "Shared-image cross-category categories are excluded before splitting; same-category variants remain together.", "Catalog field equality is the relevance definition; language naturalness and finer user intent have not been independently reviewed.", "Recall@10 ceiling is min(10,N)/N for N positives; use nDCG@10 as primary.", "Exact-ID probes measure identifier routing, not natural-language semantic relevance."],
    }
    (output_dir / "manifest.json").write_bytes(_json_bytes(manifest))
    return output_dir


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--products", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    print(build_accuracy_benchmark(args.products, args.output, seed=args.seed))


if __name__ == "__main__":
    main()

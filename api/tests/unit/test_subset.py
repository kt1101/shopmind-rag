from shopmind.app.domain.product import Product
from shopmind.pipeline.subset import select_balanced_subset


def _product(product_id: str, category: str | None) -> Product:
    return Product(product_id=product_id,title=product_id,description="",brand=None,category=category,attributes={},image_paths=())

def test_subset_selection_is_reproducible():
    products=[*[_product(f"shoe-{i}","Shoes") for i in range(5)],*[_product(f"chair-{i}","Furniture") for i in range(5)],*[_product(f"lamp-{i}","Lighting") for i in range(5)]]; first=select_balanced_subset(products,limit=6,seed=42); second=select_balanced_subset(products,limit=6,seed=42)
    assert [p.product_id for p in first]==[p.product_id for p in second]; assert len(first)==6; assert {p.category for p in first}=={"Shoes","Furniture","Lighting"}

def test_subset_unknown_category_is_kept_and_limit_is_exact():
    products=[_product("u1",None),_product("u2",None),_product("s1","Shoes")]; selected=select_balanced_subset(products,limit=2,seed=7); assert len(selected)==2; assert any(p.category is None for p in selected)

def test_subset_rejects_negative_limit():
    try: select_balanced_subset([],limit=-1,seed=1)
    except ValueError as exc: assert "limit" in str(exc)
    else: raise AssertionError("negative limit must fail")

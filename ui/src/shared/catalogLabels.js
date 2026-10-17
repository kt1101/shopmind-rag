// Display names for catalog vocabulary (categories, colours, attribute names). Keys are the
// lower-cased catalog values; anything not listed falls back to a readable humanized form, so
// a new category never renders blank or as SHOUTED_SNAKE_CASE.

export const CATEGORY_LABELS = {
  vi: {
    // mock fixture vocabulary
    running_shoes: 'Giày chạy bộ', hiking_boots: 'Giày leo núi', backpacks: 'Ba lô', jackets: 'Áo khoác',
    // real catalog (ABO product types), most frequent first
    shoes: 'Giày', cellular_phone_case: 'Ốp điện thoại', grocery: 'Thực phẩm', home: 'Đồ gia dụng',
    home_bed_and_bath: 'Chăn ga & phòng tắm', home_furniture_and_decor: 'Nội thất & trang trí', chair: 'Ghế',
    boot: 'Giày bốt', sandal: 'Dép xăng đan', health_personal_care: 'Chăm sóc cá nhân',
    finering: 'Nhẫn cao cấp', accessory: 'Phụ kiện', office_products: 'Văn phòng phẩm', fineearring: 'Bông tai cao cấp',
    table: 'Bàn', sporting_goods: 'Đồ thể thao', pet_supplies: 'Đồ cho thú cưng',
    finenecklacebraceletanklet: 'Dây chuyền, vòng tay cao cấp', outdoor_living: 'Đồ ngoài trời', rug: 'Thảm',
    sofa: 'Sofa', hat: 'Mũ', hardware_handle: 'Tay nắm cửa', janitorial_supply: 'Đồ vệ sinh', beauty: 'Làm đẹp',
    earring: 'Bông tai', light_bulb: 'Bóng đèn', flat_sheet: 'Ga trải giường', lamp: 'Đèn', wall_art: 'Tranh treo tường',
    kitchen: 'Đồ bếp', necklace: 'Dây chuyền', tools: 'Dụng cụ', furniture_cover: 'Áo bọc nội thất', handbag: 'Túi xách',
    ottoman: 'Ghế đôn', suitcase: 'Vali', backpack: 'Ba lô', drinking_cup: 'Cốc uống nước', light_fixture: 'Đèn trang trí',
    ring: 'Nhẫn', stool_seating: 'Ghế đẩu', baby_product: 'Đồ cho bé', bed: 'Giường', headphones: 'Tai nghe',
    safety_supply: 'Đồ bảo hộ', umbrella: 'Ô / dù', computer_component: 'Linh kiện máy tính', hardware: 'Đồ kim khí',
    pillow: 'Gối', portable_electronic_device_cover: 'Bao thiết bị điện tử', shelf: 'Kệ', wireless_accessory: 'Phụ kiện không dây',
    writing_instrument: 'Bút viết', auto_accessory: 'Phụ kiện ô tô', bread: 'Bánh mì', coffee: 'Cà phê', fruit: 'Trái cây',
    home_mirror: 'Gương', jar: 'Hũ', nutritional_supplement: 'Thực phẩm bổ sung', planter: 'Chậu cây', storage_hook: 'Móc treo',
    vitamin: 'Vitamin', battery: 'Pin', bean_bag_chair: 'Ghế lười', bottle: 'Chai, bình', clock: 'Đồng hồ treo',
    flatware: 'Dao nĩa', headboard: 'Đầu giường', luggage: 'Hành lý', screen_protector: 'Miếng dán màn hình',
    storage_bag: 'Túi đựng đồ', tote_bag: 'Túi tote', wallet: 'Ví', basket: 'Giỏ', bench: 'Ghế băng', bracelet: 'Vòng tay',
    cabinet: 'Tủ', charging_adapter: 'Củ sạc', desk: 'Bàn làm việc', furniture: 'Nội thất', keyboards: 'Bàn phím',
    shampoo: 'Dầu gội', trash_can: 'Thùng rác', vegetable: 'Rau củ', wine: 'Rượu vang', tea: 'Trà', watch: 'Đồng hồ đeo tay',
    sunglasses: 'Kính râm', eyewear: 'Kính mắt', speakers: 'Loa', television: 'Tivi', computer: 'Máy tính',
    personal_computer: 'Máy tính cá nhân', input_mouse: 'Chuột máy tính', dresser: 'Tủ ngăn kéo', electric_fan: 'Quạt điện',
    exercise_mat: 'Thảm tập', candle_holder: 'Chân nến', cleaning_brush: 'Bàn chải vệ sinh', clothes_rack: 'Giá phơi đồ',
    storage_box: 'Hộp đựng đồ', storage_rack: 'Giá để đồ', string_light: 'Đèn dây', kitchen_knife: 'Dao bếp',
    saute_fry_pan: 'Chảo', technical_sport_shoe: 'Giày thể thao', file_folder: 'Bìa hồ sơ', jewelry_set: 'Bộ trang sức',
    fashionearring: 'Bông tai thời trang', fashionring: 'Nhẫn thời trang', fashionnecklacebraceletanklet: 'Dây chuyền, vòng tay thời trang',
    carrying_case_or_bag: 'Túi đựng', outdoor_recreation_product: 'Đồ dã ngoại', barbecue_grill: 'Lò nướng BBQ',
    portable_stove: 'Bếp dã ngoại', freestanding_shelter: 'Lều', cookie: 'Bánh quy', chocolate_candy: 'Kẹo sô-cô-la',
    snack_chip_and_crisp: 'Snack khoai tây', toy_figure: 'Đồ chơi mô hình', home_lighting_and_lamps: 'Đèn chiếu sáng',
    laundry_detergent: 'Bột giặt', skin_moisturizer: 'Kem dưỡng ẩm', pantry: 'Đồ khô',
  },
  en: {
    finering: 'Fine Ring', fineearring: 'Fine Earring', finenecklacebraceletanklet: 'Fine Necklace & Bracelet',
    fashionearring: 'Fashion Earring', fashionring: 'Fashion Ring', fashionnecklacebraceletanklet: 'Fashion Necklace & Bracelet',
    health_personal_care: 'Health & Personal Care', home_bed_and_bath: 'Bed & Bath', home_furniture_and_decor: 'Furniture & Decor',
    cellular_phone_case: 'Phone Case', ce_carrying_case_or_bag: 'Carrying Case',
  },
}

// Catalog colours are vocabulary-normalized English words (plus a few raw values).
export const COLOR_LABELS = {
  vi: {
    black: 'Đen', brown: 'Nâu', blue: 'Xanh dương', green: 'Xanh lá', white: 'Trắng', grey: 'Xám', gray: 'Xám', red: 'Đỏ',
    beige: 'Be', pink: 'Hồng', silver: 'Bạc', gold: 'Vàng kim', yellow: 'Vàng', orange: 'Cam', purple: 'Tím',
    'navy blue': 'Xanh navy', navy: 'Xanh navy', multicolor: 'Nhiều màu', 'multi-colored': 'Nhiều màu', others: 'Màu khác',
    bronze: 'Đồng', brass: 'Đồng thau', charcoal: 'Xám than', natural: 'Màu tự nhiên', tan: 'Nâu nhạt', clear: 'Trong suốt',
    chrome: 'Crôm', ivory: 'Trắng ngà', cream: 'Kem',
  },
  en: { multicolor: 'Multicolour', 'multi-colored': 'Multicolour', others: 'Other colours' },
}

// Swatches for the colour facet (unknown colours get a neutral chip).
export const COLOR_SWATCHES = {
  black: '#22252b', brown: '#8a5a3b', blue: '#3b6fd8', green: '#3f8f5a', white: '#f4f5f7', grey: '#8b93a1', gray: '#8b93a1',
  red: '#c8423b', beige: '#cdb68f', pink: '#e58fb3', silver: '#c0c4cc', gold: '#c9a227', yellow: '#e8c547', orange: '#e8873a',
  purple: '#8a5cd6', 'navy blue': '#25355f', navy: '#25355f', bronze: '#9c6b30', brass: '#b5a642', charcoal: '#3d4249',
  tan: '#c6a27a', natural: '#d9c8a9', chrome: '#d6d9de', ivory: '#f3ecd8', cream: '#f1e6c8',
  multicolor: 'conic-gradient(#c8423b, #e8c547, #3f8f5a, #3b6fd8, #8a5cd6, #c8423b)',
  'multi-colored': 'conic-gradient(#c8423b, #e8c547, #3f8f5a, #3b6fd8, #8a5cd6, #c8423b)',
}

// Product attribute keys (product detail + compare table).
export const ATTRIBUTE_LABELS = {
  vi: {
    brand: 'Thương hiệu', category: 'Danh mục', color: 'Màu sắc', colour: 'Màu sắc', material: 'Chất liệu', style: 'Kiểu dáng',
    price: 'Giá', stock: 'Tồn kho', product_type: 'Loại sản phẩm', 'product type': 'Loại sản phẩm', size: 'Kích thước',
    pattern: 'Hoa văn', weight: 'Khối lượng', item_weight: 'Khối lượng', dimensions: 'Kích thước', model: 'Mẫu',
    model_name: 'Tên mẫu', fabric_type: 'Loại vải', finish_type: 'Bề mặt', item_shape: 'Hình dáng', shape: 'Hình dáng',
    department: 'Đối tượng', model_year: 'Năm sản xuất', product_description: 'Mô tả', item_name: 'Tên sản phẩm',
    country: 'Xuất xứ', fit: 'Dáng', closure: 'Kiểu cài', heel_type: 'Kiểu gót',
  },
  en: {
    brand: 'Brand', category: 'Category', color: 'Colour', colour: 'Colour', material: 'Material', style: 'Style', price: 'Price',
    stock: 'Stock', product_type: 'Product type', 'product type': 'Product type',
  },
}

export function catalogKey(value) {
  return String(value ?? '').trim().toLowerCase()
}

// "CELLULAR_PHONE_CASE" / "running_shoes" -> "Cellular Phone Case" / "Running Shoes".
export function humanizeValue(value) {
  return catalogKey(value)
    .replace(/^abis_/, '')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase())
}

// Attribute keys read as a sentence ("product_type" -> "Product type").
export function humanizeKey(value) {
  const text = String(value ?? '').trim().replaceAll('_', ' ').replace(/\s+/g, ' ')
  return text ? text[0].toUpperCase() + text.slice(1).toLowerCase() : ''
}

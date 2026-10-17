import { Link } from 'react-router'
import { resolveImageUrl } from '../../api.js'
import { formatPrice } from '../../lib/format.js'
import { productPath } from '../../lib/urlState.js'
import { useI18n } from '../../shared/ui/I18nProvider.jsx'
import { useShopLists } from '../../features/shop-lists/ShopListsProvider.jsx'
import { cartTotal, lineTotal } from '../../features/shop-lists/shopLists.js'
import { displayTitle } from '../../entities/product/product.js'
import './cart.css'

function Thumb({ item }) {
  const src = resolveImageUrl(item.image_url)
  return <span className="cart-thumb">{src ? <img src={src} alt="" /> : <span aria-hidden="true">◇</span>}</span>
}

export default function CartPage() {
  const { t } = useI18n()
  const { cart, wishlist, removeFromCart, setQuantity, removeFromWishlist, addToCart } = useShopLists()
  const total = cartTotal(cart)

  return (
    <div className="cart-page">
      <h1>{t('cart.title')}</h1>
      <p className="sm-muted">{t('cart.noCheckout')}</p>

      <section aria-labelledby="cart-heading" className="cart-section">
        <h2 id="cart-heading">{t('nav.cart')}</h2>
        {cart.length === 0 ? <p className="cart-empty">{t('cart.empty')}</p> : (
          <ul className="cart-list">
            {cart.map((item) => (
              <li key={item.product_id} className="cart-row">
                <Thumb item={item} />
                <Link to={productPath(item.product_id)} className="cart-title">{displayTitle(item.title)}</Link>
                <span className="cart-price">
                  {formatPrice(lineTotal(item)) ?? '—'}
                  {item.quantity > 1 && item.price && <small className="sm-muted">{t('cart.unitPrice', { price: formatPrice(item.price) })}</small>}
                </span>
                <label className="cart-qty">
                  <span className="sr-only">{t('cart.quantity')}: {displayTitle(item.title)}</span>
                  <input type="number" inputMode="numeric" min="1" max="99" value={item.quantity} onChange={(e) => setQuantity(item.product_id, e.target.value)} />
                </label>
                <button type="button" className="sm-button sm-button--small" onClick={() => removeFromCart(item.product_id)} aria-label={`${t('cart.remove')}: ${displayTitle(item.title)}`}>{t('cart.remove')}</button>
              </li>
            ))}
          </ul>
        )}
        {total && (
          <p className="cart-total">
            <span>{t('cart.total')}</span>
            <strong>{formatPrice(total)}</strong> <span className="sm-badge sm-badge--warning">{t('product.synthetic')}</span>
          </p>
        )}
      </section>

      <section aria-labelledby="wishlist-heading" className="cart-section" id="wishlist">
        <h2 id="wishlist-heading">{t('nav.wishlist')}</h2>
        {wishlist.length === 0 ? <p className="cart-empty">{t('cart.wishlistEmpty')}</p> : (
          <ul className="cart-list">
            {wishlist.map((item) => (
              <li key={item.product_id} className="cart-row">
                <Thumb item={item} />
                <Link to={productPath(item.product_id)} className="cart-title">{displayTitle(item.title)}</Link>
                <span className="cart-price">{formatPrice(item.price) ?? '—'}</span>
                <button type="button" className="sm-button sm-button--small" onClick={() => addToCart(item)} aria-label={`${t('product.addToCart')}: ${displayTitle(item.title)}`}>{t('product.addToCart')}</button>
                <button type="button" className="sm-button sm-button--small sm-button--ghost" onClick={() => removeFromWishlist(item.product_id)} aria-label={`${t('cart.remove')}: ${displayTitle(item.title)}`}>{t('cart.remove')}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

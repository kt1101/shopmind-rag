import { Link } from 'react-router'
import { resolveImageUrl } from '../../api.js'
import { useI18n } from '../../shared/ui/I18nProvider.jsx'
import { displayTitle } from '../../entities/product/product.js'
import { useShopLists } from '../shop-lists/ShopListsProvider.jsx'
import { COMPARE_MAX, buildCompareUrl } from '../shop-lists/shopLists.js'
import './compare.css'

export default function CompareTray() {
  const { compare, removeFromCompare, clearCompare } = useShopLists()
  const { t } = useI18n()
  if (!compare.length) return null
  const slots = Array.from({ length: COMPARE_MAX }, (_, i) => compare[i] || null)

  return (
    <aside className="compare-tray" aria-label={t('compare.tray')}>
      <div className="compare-tray-head">
        <strong>{t('compare.tray')}</strong>
        <span className="sm-muted sm-small">{t('compare.trayCount', { count: compare.length })}</span>
      </div>
      <ul className="compare-tray-slots">
        {slots.map((item, index) => (
          <li key={item?.product_id || `empty-${index}`} className={`compare-tray-slot ${item ? '' : 'is-empty'}`}>
            {item ? (
              <>
                {resolveImageUrl(item.image_url) ? <img src={resolveImageUrl(item.image_url)} alt="" /> : <span aria-hidden="true">◇</span>}
                <span className="compare-tray-title" title={displayTitle(item.title)}>{displayTitle(item.title)}</span>
                <button type="button" className="compare-tray-remove" aria-label={t('compare.remove', { title: displayTitle(item.title) })} onClick={() => removeFromCompare(item.product_id)}>×</button>
              </>
            ) : <span aria-hidden="true">+</span>}
          </li>
        ))}
      </ul>
      <div className="compare-tray-actions">
        {compare.length >= 2 ? (
          <Link className="sm-button sm-button--primary" to={buildCompareUrl(compare.map((item) => item.product_id))}>{t('compare.go')}</Link>
        ) : (
          <span className="sm-small sm-muted">{t('compare.needTwo')}</span>
        )}
        <button type="button" className="sm-button sm-button--ghost sm-button--small" onClick={clearCompare}>{t('compare.clear')}</button>
      </div>
    </aside>
  )
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { readJSON, writeJSON } from '../../shared/lib/storage.js'
import { useI18n } from '../../shared/ui/I18nProvider.jsx'
import { useToast } from '../../shared/ui/Toast.jsx'
import {
  COMPARE_MAX, STORAGE_KEYS, addToCart as addToCartList, cartCount, includesId, removeItem, sanitizeList, setCartQuantity, toggleItem,
} from './shopLists.js'

const ShopListsContext = createContext(null)

function usePersistentList(key, options) {
  const [list, setList] = useState(() => sanitizeList(readJSON(key, []), options))
  useEffect(() => {
    writeJSON(key, list)
  }, [key, list])
  // Keep tabs in sync.
  useEffect(() => {
    function onStorage(event) {
      if (event.key === key) setList(sanitizeList(readJSON(key, []), options))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
    // options are static per list
  }, [key])
  return [list, setList]
}

const COMPARE_OPTIONS = { max: COMPARE_MAX }
const CART_OPTIONS = { withQuantity: true }

export function ShopListsProvider({ children }) {
  const [compare, setCompare] = usePersistentList(STORAGE_KEYS.compare, COMPARE_OPTIONS)
  const [wishlist, setWishlist] = usePersistentList(STORAGE_KEYS.wishlist)
  const [cart, setCart] = usePersistentList(STORAGE_KEYS.cart, CART_OPTIONS)
  const { toast } = useToast()
  const { t } = useI18n()

  const toggleCompare = useCallback((product) => {
    const result = toggleItem(compare, product, COMPARE_MAX)
    if (result.status === 'full') toast(t('compare.full'), { tone: 'error' })
    else if (result.status === 'added') toast(t('compare.added'))
    setCompare(result.list)
    return result.status
  }, [compare, setCompare, toast, t])

  const toggleWishlist = useCallback((product) => {
    const result = toggleItem(wishlist, product)
    if (result.status === 'added') toast(t('wishlist.added'))
    else if (result.status === 'removed') toast(t('wishlist.removed'))
    setWishlist(result.list)
    return result.status
  }, [wishlist, setWishlist, toast, t])

  const addToCart = useCallback((product, quantity = 1) => {
    setCart((current) => addToCartList(current, product, quantity))
    toast(t('cart.added'), { tone: 'success' })
  }, [setCart, toast, t])

  const value = useMemo(() => ({
    compare,
    wishlist,
    cart,
    cartCount: cartCount(cart),
    toggleCompare,
    removeFromCompare: (id) => setCompare((current) => removeItem(current, id)),
    clearCompare: () => setCompare([]),
    isComparing: (id) => includesId(compare, id),
    toggleWishlist,
    isWishlisted: (id) => includesId(wishlist, id),
    removeFromWishlist: (id) => setWishlist((current) => removeItem(current, id)),
    addToCart,
    removeFromCart: (id) => setCart((current) => removeItem(current, id)),
    setQuantity: (id, quantity) => setCart((current) => setCartQuantity(current, id, quantity)),
    cartQuantity: (id) => cart.find((x) => x.product_id === String(id))?.quantity ?? 0,
  }), [compare, wishlist, cart, toggleCompare, toggleWishlist, addToCart, setCompare, setWishlist, setCart])

  return <ShopListsContext.Provider value={value}>{children}</ShopListsContext.Provider>
}

export function useShopLists() {
  const context = useContext(ShopListsContext)
  if (!context) throw new Error('useShopLists must be used within a ShopListsProvider')
  return context
}

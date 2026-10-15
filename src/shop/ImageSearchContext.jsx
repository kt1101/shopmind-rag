import { createContext, useContext, useMemo, useState } from 'react'

export const ImageSearchContext = createContext({
  imageFile: null,
  setImageFile: () => {},
})

export function ImageSearchProvider({ children }) {
  const [imageFile, setImageFile] = useState(null)

  const value = useMemo(
    () => ({
      imageFile,
      setImageFile,
    }),
    [imageFile],
  )

  return (
    <ImageSearchContext.Provider value={value}>
      {children}
    </ImageSearchContext.Provider>
  )
}

export function useImageSearch() {
  return useContext(ImageSearchContext)
}

import { useState, useEffect, ImgHTMLAttributes } from "react";

interface OptimizedImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  fallback?: string;
  lazy?: boolean;
  placeholder?: string;
}

/**
 * Optimized Image Component with Lazy Loading
 * Improves page load performance
 */
export function OptimizedImage({
  src,
  fallback = "/placeholder.png",
  lazy = true,
  placeholder,
  className = "",
  alt = "",
  ...props
}: OptimizedImageProps) {
  const [imageSrc, setImageSrc] = useState(placeholder || src);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!lazy) {
      loadImage();
    }
  }, [src]);

  const loadImage = () => {
    const img = new Image();
    img.src = src;
    
    img.onload = () => {
      setImageSrc(src);
      setIsLoading(false);
      setHasError(false);
    };
    
    img.onerror = () => {
      setImageSrc(fallback);
      setIsLoading(false);
      setHasError(true);
    };
  };

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={`${className} ${isLoading ? "blur-sm" : ""} transition-all duration-300`}
      loading={lazy ? "lazy" : "eager"}
      onLoad={() => setIsLoading(false)}
      onError={() => {
        setImageSrc(fallback);
        setHasError(true);
      }}
      {...props}
    />
  );
}

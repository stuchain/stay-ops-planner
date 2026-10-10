import type { MetadataRoute } from "next";

/** Lets the app be installed from the browser and open in its own window. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Διαμερίσματα",
    short_name: "Διαμερίσματα",
    description: "Κρατήσεις και διαμερίσματα",
    lang: "el",
    start_url: "/app/today",
    scope: "/",
    display: "standalone",
    background_color: "#F2F1EE",
    theme_color: "#1E4B8F",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

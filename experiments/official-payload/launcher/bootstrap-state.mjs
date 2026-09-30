export function shouldBootstrap({ markerExists, currentJsonExists, versionDirectoryExists }) {
  return Boolean(markerExists) && (!currentJsonExists || !versionDirectoryExists);
}

export const missingPhotoText = "Foto no disponible para esta persona.";

export function PhotoPlaceholder() {
  return <div className="photo-placeholder" role="img" aria-label={missingPhotoText}>
    <span aria-hidden="true">◇</span>
    <p>Foto no disponible</p>
  </div>;
}

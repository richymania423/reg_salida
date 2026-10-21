# Registro de Lecturas QR (con Google Sheets)

Aplicación web para **escanear códigos QR seguros** y registrar automáticamente
**fecha, hora y nombre** del dueño en una hoja de **Google Sheets**. Incluye respaldo
local y exportación CSV.

## Archivos

| Archivo | Función |
|---------|---------|
| `index.html` | Interfaz de la app |
| `styles.css` | Estilos |
| `app.js` | Lógica: escáner, validación de firma, envío a Google Sheets |
| `generar-qr.js` | Genera QR seguros en SVG (Node, sin dependencias) |
| `qr-prueba.html` | Genera QR seguros desde el navegador (con nombre/ID editables) |
| `qr-richard-siza.svg` | QR de ejemplo de Richard Siza |
| `google-apps-script/Code.gs` | Backend para Google Sheets |

## 1. Seguridad del QR (anti-duplicación)

Cada QR contiene un JSON con firma:

```json
{ "n": "Richard Siza", "id": "EMP-001", "nc": "<nonce aleatorio>", "sig": "<firma HMAC>" }
```

- `sig` = `HMAC-SHA256( id|nombre|nonce , CLAVE_SECRETA )` truncado.
- **Nadie puede fabricar un QR válido nuevo** sin la clave secreta: la app rechaza
  cualquier QR con firma inválida.
- **Un QR solo se registra una vez por día.** El mismo QR (mismo `id`) puede leerse
  una vez cada día, pero no dos veces el mismo día. La app y Google Sheets rechazan
  la segunda lectura del día e indican a qué hora se registró la primera.

> La misma `CLAVE_SECRETA` debe estar en **tres sitios**: `generar-qr.js`, `app.js`
> y `google-apps-script/Code.gs`. Cámbiala por una tuya, larga y privada.

> Nota: como un QR es una imagen, siempre se puede fotocopiar. Lo que impide el
> fraude es la firma (no se pueden crear QR nuevos) y el límite de una lectura por
> día por QR (un mismo QR no se registra dos veces el mismo día).

## 2. Configurar Google Sheets

1. Crea una hoja en https://sheets.google.com.
2. Menú **Extensiones > Apps Script**. Borra el contenido y pega
   `google-apps-script/Code.gs`.
3. Cambia `CLAVE_SECRETA` por la tuya (la misma de los QR).
4. **Implementar > Nueva implementación > Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
5. Copia la URL que termina en `/exec`.

## 3. Configurar la app

1. Abre la app (ver sección 5) y pega la URL `/exec` en el campo **Google Sheets**,
   pulsa **Guardar URL**.
2. Verifica que `CLAVE_SECRETA` en `app.js` coincide con la del backend.

## 4. Generar QR

### Desde el navegador (fácil)
Abre `qr-prueba.html`, escribe nombre e ID, pulsa **Generar** y luego
**Imprimir / Guardar PDF**.

### Desde Node (por lotes / SVG)
```powershell
node generar-qr.js "Richard Siza" "EMP-001" "qr-richard-siza.svg"
node generar-qr.js "Ana Torres" "EMP-002" "qr-ana.svg"
```

## 5. Ejecutar la app

La cámara requiere `https://` o `localhost`. Con Python:

```powershell
python -m http.server 8000
```

Abre http://localhost:8000. Pulsa **Iniciar cámara** y escanea un QR. Cada lectura
válida se guarda en Google Sheets (y localmente como respaldo).

## 6. Reporte

- **En Google Sheets**: la hoja se llena con Fecha, Hora, Nombre, ID, Nonce, Token e ISO.
  Puedes filtrar, graficar o crear tablas dinámicas directamente ahí.
- **En la app**: botón **Exportar CSV** para descargar un reporte local.
- Si no hay conexión al escanear, la lectura queda en estado "local" (naranja) y se
  envía luego con el botón **Sincronizar pendientes**.

## Alojar la app gratis (opcional)

Sube esta carpeta a GitHub y activa **GitHub Pages** para tener la app en HTTPS
(la cámara funcionará sin servidor local). Los datos seguirán yendo a tu Google Sheets.

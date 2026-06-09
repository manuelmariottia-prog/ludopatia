# Ludopatía S&M

App web para registrar partidas de Manu y Sofi.

## Cómo abrirla rápido

### Opción recomendada con VS Code
1. Abrí esta carpeta en Visual Studio Code.
2. Instalá la extensión **Live Server**.
3. Clic derecho en `index.html`.
4. Elegí **Open with Live Server**.

### Opción con terminal
```bash
npm install
npm run dev
```

Luego abrí la dirección que aparezca, normalmente:

```text
http://localhost:5173
```

## Datos
La app ya viene con las partidas importadas desde el Excel original.

## Sincronización online
Por ahora guarda los cambios en el navegador usando `localStorage`.
El archivo `firebase-config.js` queda preparado para activar Firebase más adelante y que Manu y Sofi puedan cargar partidas desde distintos dispositivos.

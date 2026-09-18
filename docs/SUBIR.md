# Cómo subirlo a GitHub

API REST de seguimiento de candidaturas: historial de eventos, autenticación con JWT rotado y estadísticas de respuesta.

## 1 · Crear el repositorio y subirlo

En GitHub, crea un repositorio nuevo llamado `api-postulaciones`, **público** y **vacío**
(sin README, sin licencia, sin .gitignore — ya están aquí). Después, desde esta
carpeta:

```bash
git init
git add .
git commit -m "Primera versión"
git branch -M main
git remote add origin https://github.com/danielbuitragoh/api-postulaciones.git
git push -u origin main
```

Si la carpeta ya tenía git, sáltate `git init` y `git branch -M main`.

## 2 · Antes de publicar, comprueba

Que no sube ningún secreto:

```bash
git ls-files | grep -iE "\.env$|secret|credential"
```

Debe devolver vacío (o solo archivos `.ejemplo`).



## 3 · Los dos minutos que más rinden

En la portada del repositorio, junto a **About** (arriba a la derecha, el
engranaje):

- **Descripción:** API REST de seguimiento de candidaturas: historial de eventos, autenticación con JWT rotado y estadísticas de respuesta.
- **Website:** el enlace de la demo si la hay, y si no, tu portafolio.
- **Topics:** `nodejs, express, postgresql, typescript, rest-api, jwt, argon2, zod, vitest, authentication`

Los topics son lo que hace que el repositorio aparezca en búsquedas de GitHub.

Y fíjalo en tu perfil: **tu perfil → Customize your pins**.

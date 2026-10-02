# Immagine del frontend web: build di Vite in uno stadio Node, file statici
# serviti da nginx, che inoltra anche /api/ al backend (vedi nginx.conf).
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# Vite incorpora questi valori nella build statica. La chiave è pubblica nel
# browser e deve essere limitata in Google Cloud ai referrer e alla Maps JS API.
ARG VITE_GOOGLE_MAPS_API_KEY=""
ARG VITE_GOOGLE_MAPS_MAP_ID=""
# tsc --noEmit + vite build: una build con errori di tipo non produce l'immagine.
RUN npm run build

FROM nginx:stable-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

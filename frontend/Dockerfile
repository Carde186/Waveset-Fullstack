# Immagine del frontend web: build di Vite in uno stadio Node, file statici
# serviti da nginx, che inoltra anche /api/ al backend (vedi nginx.conf).
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# tsc --noEmit + vite build: una build con errori di tipo non produce l'immagine.
RUN npm run build

FROM nginx:stable-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

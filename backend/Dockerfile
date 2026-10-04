FROM node:20-alpine

WORKDIR /app

# Strumenti di build per bcrypt (modulo nativo): se non trova un binario
# precompilato per l'architettura dell'immagine lo compila con node-gyp.
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY db/init/13_ticketmaster_sync_schema.sql ./db/init/13_ticketmaster_sync_schema.sql
COPY db/init/14_apple_music_provider_schema.sql ./db/init/14_apple_music_provider_schema.sql

COPY db/init/15_artista_ticketmaster_presenza_schema.sql ./db/init/15_artista_ticketmaster_presenza_schema.sql

COPY db/init/16_ollama_eventi_schema.sql ./db/init/16_ollama_eventi_schema.sql

EXPOSE 3000

CMD ["node", "src/server.js"]

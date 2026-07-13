# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Relative path so the browser calls same-origin /api/* — nginx.conf
# proxies that to the backend. Only meaningful at build time (Vite inlines
# env vars into the bundle), so it's an ARG, not a runtime ENV on the
# final nginx image.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# --- Serve stage ---
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# .template + the templates/ directory triggers the base image's built-in
# envsubst step at container start — see nginx.conf's header comment.
COPY nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80

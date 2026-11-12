FROM node:22-bookworm AS frontend
WORKDIR /src/seanime-web
COPY seanime-web/ ./
RUN npm ci && npm run build

FROM golang:1.27.1-bookworm AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /src/seanime-web/out/ ./web/
RUN cp seanime-web/public/anidash-logo.png internal/icon/logo.png && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /anidash .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg tini gosu && rm -rf /var/lib/apt/lists/* && groupadd -g 10001 anidash && useradd -u 10001 -g 10001 -m anidash && mkdir -p /data /media /app && chown -R anidash:anidash /data /app
WORKDIR /app
COPY --from=backend /anidash /app/anidash
COPY --chmod=755 deploy/entrypoint.sh /app/entrypoint.sh
ENV SEANIME_DATA_DIR=/data SEANIME_SERVER_HOST=0.0.0.0 SEANIME_SERVER_PORT=43211
EXPOSE 43211
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/tini","--","/app/entrypoint.sh"]

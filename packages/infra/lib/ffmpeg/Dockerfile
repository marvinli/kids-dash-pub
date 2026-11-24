# Static ffmpeg for the video converter's Lambda layer: an arm64 binary (the
# function's architecture) with libx264 for the frame's H.264 and zimg
# (zscale) to tone-map phone HDR. Only that stage is arm64; the copy into the
# layer (/opt/bin/ffmpeg) runs on the host's own platform, so synth works on
# x64 CI without emulation.
FROM --platform=linux/arm64 mwader/static-ffmpeg:7.1 AS ffmpeg
FROM alpine:3.20
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg

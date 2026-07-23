-- Enable mp3-based podcasts alongside YouTube ones. When mp3Url is set, the
-- frontend renders an HTML audio player instead of the YouTube iframe.
-- Existing rows default to '' (empty) which the frontend treats as
-- "still a YouTube podcast".

ALTER TABLE "Podcast" ADD COLUMN "mp3Url" TEXT NOT NULL DEFAULT '';

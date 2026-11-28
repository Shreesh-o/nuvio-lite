#!/usr/bin/env python3
"""Generate deterministic local MP4, MKV, and HLS test media fixtures rapidly via -stream_loop and ffprobe ground truth."""

import json
import os
import subprocess
import time

MEDIA_DIR = "/home/shreesh/nuvio-audit/audit/fixtures/media"
TRUTH_PATH = "/home/shreesh/nuvio-audit/audit/fixtures/ffprobe_truth.json"


def run(cmd):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"Command failed ({p.returncode}): {' '.join(cmd)}\n{p.stderr[-1000:]}")
    return p.stdout


def ffprobe_json(path):
    out = run([
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        "-show_chapters",
        path,
    ])
    return json.loads(out)


def make_srt(path, lines):
    with open(path, "w", encoding="utf-8") as f:
        for idx, (start, end, txt) in enumerate(lines, 1):
            f.write(f"{idx}\n{start} --> {end}\n{txt}\n\n")


def make_vtt(path, lines):
    with open(path, "w", encoding="utf-8") as f:
        f.write("WEBVTT\n\n")
        for start, end, txt in lines:
            f.write(f"{start} --> {end}\n{txt}\n\n")


def generate_fixtures():
    os.makedirs(MEDIA_DIR, exist_ok=True)
    tmp_dir = "/home/shreesh/nuvio-audit/audit/fixtures/_tmp"
    os.makedirs(tmp_dir, exist_ok=True)

    sub_en = os.path.join(tmp_dir, "en.srt")
    sub_hi = os.path.join(tmp_dir, "hi.srt")
    sub_mr = os.path.join(tmp_dir, "mr.srt")
    make_srt(sub_en, [("00:00:01,000", "00:00:04,000", "English dialogue sample")])
    make_srt(sub_hi, [("00:00:01,000", "00:00:04,000", "Hindi संवाद नमूना")])
    make_srt(sub_mr, [("00:00:01,000", "00:00:04,000", "Marathi संवाद नमुना")])

    # Helper base streams (6s each -> loop 439 times = 2640s = 44m00s, loop 19 = 120s = 2m00s)
    v1080_h264 = os.path.join(tmp_dir, "v1080_h264.mkv")
    v720_h264 = os.path.join(tmp_dir, "v720_h264.mkv")
    v720_hevc = os.path.join(tmp_dir, "v720_hevc.mkv")
    a_aac = os.path.join(tmp_dir, "a_aac.m4a")
    a_opus = os.path.join(tmp_dir, "a_opus.mka")
    a_ac3 = os.path.join(tmp_dir, "a_ac3.mka")

    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=c=#102030:s=1920x1080:r=24:d=6",
        "-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-crf", "35",
        v1080_h264,
    ])
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=c=#201010:s=1280x720:r=24:d=6",
        "-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-crf", "35",
        v720_h264,
    ])
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=c=#103010:s=1280x720:r=24:d=6",
        "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "log-level=error:crf=38",
        v720_hevc,
    ])
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=6",
        "-c:a", "aac", "-b:a", "24k", "-ac", "2", a_aac,
    ])
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=6",
        "-c:a", "libopus", "-b:a", "24k", a_opus,
    ])
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=5.1:d=6",
        "-c:a", "ac3", "-b:a", "96k", a_ac3,
    ])

    # 1. MP4 faststart (moov at front): 1920x1080 H.264, dual-audio Hindi+English AAC, embedded mov_text subs, S01E02 tags, 2640s
    mp4_fast = os.path.join(MEDIA_DIR, "Show.Alpha.S01E02.1080p.WEB-DL.x264.AAC.Hindi-English.mp4")
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-stream_loop", "439", "-i", v1080_h264,
        "-stream_loop", "439", "-i", a_aac,
        "-stream_loop", "439", "-i", a_aac,
        "-i", sub_hi, "-i", sub_en,
        "-map", "0:v:0", "-map", "1:a:0", "-map", "2:a:0", "-map", "3:s:0", "-map", "4:s:0",
        "-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text",
        "-metadata", "title=Show Alpha - S01E02 - The Signal",
        "-metadata", "show=Show Alpha",
        "-metadata", "episode_id=S01E02",
        "-metadata", "season_number=1",
        "-metadata", "episode_sort=2",
        "-metadata", "comment=imdb:tt1234567 tmdb:999001",
        "-metadata:s:a:0", "language=hin", "-metadata:s:a:0", "title=Hindi [Original]",
        "-metadata:s:a:1", "language=eng", "-metadata:s:a:1", "title=English [Dub]",
        "-metadata:s:s:0", "language=hin", "-metadata:s:s:0", "title=Hindi",
        "-metadata:s:s:1", "language=eng", "-metadata:s:s:1", "title=English",
        "-movflags", "+faststart",
        mp4_fast,
    ])

    # 2. MP4 moov-at-end (NOT faststart): 1280x720 H.264, single Marathi audio (mar), no S/E tags, 2640s (~10+ MB so mdat pushes moov well past 64 KiB)
    mp4_end = os.path.join(MEDIA_DIR, "Show.Alpha.720p.Marathi.moov_end.mp4")
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-stream_loop", "439", "-i", v720_h264,
        "-stream_loop", "439", "-i", a_aac,
        "-i", sub_mr,
        "-map", "0:v:0", "-map", "1:a:0", "-map", "2:s:0",
        "-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text",
        "-metadata:s:a:0", "language=mar", "-metadata:s:a:0", "title=Marathi",
        "-metadata:s:s:0", "language=mar", "-metadata:s:s:0", "title=Marathi",
        mp4_end,
    ])

    # 3. MP4 trailer clip: 1920x1080 H.264, English AAC audio, 120s (2m00s)
    mp4_trailer = os.path.join(MEDIA_DIR, "Show.Alpha.Official.Trailer.1080p.mp4")
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-stream_loop", "19", "-i", v1080_h264,
        "-stream_loop", "19", "-i", a_aac,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c", "copy",
        "-metadata", "title=Show Alpha - Official Season 1 Trailer",
        "-metadata:s:a:0", "language=eng", "-metadata:s:a:0", "title=English",
        "-movflags", "+faststart",
        mp4_trailer,
    ])

    # 4. MKV multi-language HEVC: 1280x720 HEVC, 4 audio (hin Opus, eng AAC, mar AC3, und Opus), 3 SRT subs, 2640s
    mkv_multi = os.path.join(MEDIA_DIR, "Show.Alpha.S01E02.720p.HEVC.MultiAudio.mkv")
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-stream_loop", "439", "-i", v720_hevc,
        "-stream_loop", "439", "-i", a_opus,
        "-stream_loop", "439", "-i", a_aac,
        "-stream_loop", "439", "-i", a_ac3,
        "-stream_loop", "439", "-i", a_opus,
        "-i", sub_hi, "-i", sub_en, "-i", sub_mr,
        "-map", "0:v:0", "-map", "1:a:0", "-map", "2:a:0", "-map", "3:a:0", "-map", "4:a:0",
        "-map", "5:s:0", "-map", "6:s:0", "-map", "7:s:0",
        "-c", "copy",
        "-metadata", "title=Show Alpha S01E02 [HEVC Multi]",
        "-metadata", "SHOW=Show Alpha",
        "-metadata", "SEASON=1",
        "-metadata", "EPISODE=2",
        "-metadata:s:a:0", "language=hin", "-metadata:s:a:0", "title=Hindi",
        "-metadata:s:a:1", "language=eng", "-metadata:s:a:1", "title=English",
        "-metadata:s:a:2", "language=mar", "-metadata:s:a:2", "title=Marathi 5.1",
        "-metadata:s:a:3", "language=und", "-metadata:s:a:3", "title=Track 4 Unlabelled",
        "-metadata:s:s:0", "language=hin", "-metadata:s:s:0", "title=Hindi",
        "-metadata:s:s:1", "language=eng", "-metadata:s:s:1", "title=English",
        "-metadata:s:s:2", "language=mar", "-metadata:s:s:2", "title=Marathi",
        mkv_multi,
    ])

    # 5. MKV unlabelled / wrong-episode trap: 1920x1080 H.264, 2 unlabelled audio tracks (und), no subs, tagged S01E03, same 2640s duration!
    mkv_unlabelled_wrong_ep = os.path.join(MEDIA_DIR, "Show.Alpha.S01E03.1080p.x264.Unlabelled.mkv")
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-stream_loop", "439", "-i", v1080_h264,
        "-stream_loop", "439", "-i", a_aac,
        "-stream_loop", "439", "-i", a_aac,
        "-map", "0:v:0", "-map", "1:a:0", "-map", "2:a:0",
        "-c", "copy",
        "-metadata", "title=Show Alpha S01E03 - Wrong Episode Same Runtime",
        "-metadata:s:a:0", "language=und", "-metadata:s:a:0", "title=Audio 1",
        "-metadata:s:a:1", "language=und", "-metadata:s:a:1", "title=Audio 2",
        mkv_unlabelled_wrong_ep,
    ])

    # 6. HLS multi-variant + separate audio/subtitle groups (hi, en, mr, unlabelled) + real TS segments
    hls_multi_dir = os.path.join(MEDIA_DIR, "hls_multi")
    os.makedirs(hls_multi_dir, exist_ok=True)
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", v1080_h264, "-an", "-c:v", "copy",
        "-f", "hls", "-hls_time", "6", "-hls_list_size", "0",
        "-hls_segment_filename", os.path.join(hls_multi_dir, "v1080_seg%d.ts"),
        os.path.join(hls_multi_dir, "v1080_raw.m3u8"),
    ])
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", v720_h264, "-an", "-c:v", "copy",
        "-f", "hls", "-hls_time", "6", "-hls_list_size", "0",
        "-hls_segment_filename", os.path.join(hls_multi_dir, "v720_seg%d.ts"),
        os.path.join(hls_multi_dir, "v720_raw.m3u8"),
    ])
    for code in ["hi", "en", "mr", "und"]:
        run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", a_aac, "-c", "copy",
            "-f", "hls", "-hls_time", "6", "-hls_list_size", "0",
            "-hls_segment_filename", os.path.join(hls_multi_dir, f"audio_{code}_seg%d.ts"),
            os.path.join(hls_multi_dir, f"audio_{code}_raw.m3u8"),
        ])

    def write_vod_playlist(fname, seg_name, count=440, seg_dur=6.0):
        p = os.path.join(hls_multi_dir, fname)
        with open(p, "w", encoding="utf-8") as f:
            f.write("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n")
            for _ in range(count):
                f.write(f"#EXTINF:{seg_dur:.3f},\n{seg_name}\n")
            f.write("#EXT-X-ENDLIST\n")

    write_vod_playlist("v1080.m3u8", "v1080_seg0.ts", count=440, seg_dur=6.0)
    write_vod_playlist("v720.m3u8", "v720_seg0.ts", count=440, seg_dur=6.0)
    for code in ["hi", "en", "mr", "und"]:
        write_vod_playlist(f"audio_{code}.m3u8", f"audio_{code}_seg0.ts", count=440, seg_dur=6.0)

    make_vtt(os.path.join(hls_multi_dir, "sub_en.vtt"), [("00:00:01.000", "00:00:04.000", "English subtitle")])
    make_vtt(os.path.join(hls_multi_dir, "sub_hi.vtt"), [("00:00:01.000", "00:00:04.000", "Hindi subtitle")])
    make_vtt(os.path.join(hls_multi_dir, "sub_mr.vtt"), [("00:00:01.000", "00:00:04.000", "Marathi subtitle")])
    for code in ["en", "hi", "mr"]:
        with open(os.path.join(hls_multi_dir, f"sub_{code}.m3u8"), "w", encoding="utf-8") as f:
            f.write(f"#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2640\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:2640.000,\nsub_{code}.vtt\n#EXT-X-ENDLIST\n")

    with open(os.path.join(hls_multi_dir, "master.m3u8"), "w", encoding="utf-8") as f:
        f.write(
            "#EXTM3U\n"
            "#EXT-X-VERSION:4\n"
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Hindi",LANGUAGE="hi",DEFAULT=YES,AUTOSELECT=YES,URI="audio_hi.m3u8"\n'
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="audio_en.m3u8"\n'
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Marathi",LANGUAGE="mr",DEFAULT=NO,AUTOSELECT=YES,URI="audio_mr.m3u8"\n'
            '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Hindi",LANGUAGE="hi",DEFAULT=YES,AUTOSELECT=YES,URI="sub_hi.m3u8"\n'
            '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="sub_en.m3u8"\n'
            '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Marathi",LANGUAGE="mr",DEFAULT=NO,AUTOSELECT=YES,URI="sub_mr.m3u8"\n'
            '#EXT-X-STREAM-INF:BANDWIDTH=4200000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"\n'
            "v1080.m3u8\n"
            '#EXT-X-STREAM-INF:BANDWIDTH=2100000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"\n'
            "v720.m3u8\n"
        )

    hls_unlab_dir = os.path.join(MEDIA_DIR, "hls_unlabelled")
    os.makedirs(hls_unlab_dir, exist_ok=True)
    with open(os.path.join(hls_unlab_dir, "master.m3u8"), "w", encoding="utf-8") as f:
        f.write(
            "#EXTM3U\n"
            "#EXT-X-VERSION:4\n"
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Audio Track 1",DEFAULT=YES,AUTOSELECT=YES,URI="../hls_multi/audio_und.m3u8"\n'
            '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="aud"\n'
            "../hls_multi/v720.m3u8\n"
        )

    hls_tr_dir = os.path.join(MEDIA_DIR, "hls_trailer")
    os.makedirs(hls_tr_dir, exist_ok=True)
    with open(os.path.join(hls_tr_dir, "v1080_trailer.m3u8"), "w", encoding="utf-8") as f:
        f.write("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n")
        for _ in range(20):
            f.write("#EXTINF:6.000,\n../hls_multi/v1080_seg0.ts\n")
        f.write("#EXT-X-ENDLIST\n")
    with open(os.path.join(hls_tr_dir, "master.m3u8"), "w", encoding="utf-8") as f:
        f.write(
            "#EXTM3U\n"
            "#EXT-X-VERSION:4\n"
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="../hls_multi/audio_en.m3u8"\n'
            '#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="aud"\n'
            "v1080_trailer.m3u8\n"
        )

    targets = {
        "mp4_fast_s01e02": mp4_fast,
        "mp4_moov_end_mar": mp4_end,
        "mp4_trailer": mp4_trailer,
        "mkv_multi_h265": mkv_multi,
        "mkv_unlabelled_wrong_ep": mkv_unlabelled_wrong_ep,
        "hls_multi_master": os.path.join(hls_multi_dir, "master.m3u8"),
        "hls_unlabelled_master": os.path.join(hls_unlab_dir, "master.m3u8"),
        "hls_trailer_master": os.path.join(hls_tr_dir, "master.m3u8"),
    }

    truth = {}
    for key, path in targets.items():
        probe = ffprobe_json(path)
        size_bytes = os.path.getsize(path)
        streams = probe.get("streams", [])
        fmt = probe.get("format", {})
        video = [s for s in streams if s.get("codec_type") == "video"]
        audio = [s for s in streams if s.get("codec_type") == "audio"]
        subs = [s for s in streams if s.get("codec_type") == "subtitle"]
        truth[key] = {
            "path": path,
            "fileSizeBytes": size_bytes,
            "formatName": fmt.get("format_name"),
            "durationSec": float(fmt["duration"]) if "duration" in fmt else None,
            "tags": fmt.get("tags", {}),
            "video": [
                {"codec": s.get("codec_name"), "width": s.get("width"), "height": s.get("height")}
                for s in video
            ],
            "audio": [
                {
                    "index": s.get("index"),
                    "codec": s.get("codec_name"),
                    "channels": s.get("channels"),
                    "channelLayout": s.get("channel_layout"),
                    "sampleRate": s.get("sample_rate"),
                    "language": (s.get("tags") or {}).get("language"),
                    "title": (s.get("tags") or {}).get("title"),
                }
                for s in audio
            ],
            "subtitles": [
                {
                    "index": s.get("index"),
                    "codec": s.get("codec_name"),
                    "language": (s.get("tags") or {}).get("language"),
                    "title": (s.get("tags") or {}).get("title"),
                }
                for s in subs
            ],
        }
        print(f"[truth] {key}: container={truth[key]['formatName']} dur={truth[key]['durationSec']}s "
              f"size={size_bytes}B vid={truth[key]['video']} aud={len(truth[key]['audio'])} sub={len(truth[key]['subtitles'])}")

    with open(TRUTH_PATH, "w", encoding="utf-8") as f:
        json.dump(truth, f, indent=2)
    print(f"Wrote {TRUTH_PATH}")


if __name__ == "__main__":
    t0 = time.time()
    generate_fixtures()
    print(f"Done in {time.time() - t0:.2f}s")

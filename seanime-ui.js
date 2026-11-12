/* SPDX-License-Identifier: GPL-3.0-only
 * AniDash adaptation of Seanime by 5rahim and contributors.
 * Source: https://github.com/5rahim/seanime/tree/4bdff7b27b6c043dc87c0ccad3ead54596133a05
 * Adapted from discover-page-header.tsx and media-entry-card-components.tsx.
 * The existing AniDash event router owns interactions and per-browser state.
 */
(function () {
  "use strict";
  const e = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const title = m => m?.title?.english || m?.title?.romaji || m?.title?.native || "Unknown title";
  const image = m => m?.coverImage?.extraLarge || m?.coverImage?.large || m?.coverImage?.medium || "";
  const safeImage = value => /^https:\/\//i.test(value || "") ? e(value) : "";
  const plain = value => String(value || "").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
  function card(media, {type="ANIME", season="", score="", year="", episodes="", progress=0, resume="", star=""}={}) {
    const isManga = type === "MANGA", attr = isManga ? "data-manga" : "data-anime";
    const poster = safeImage(image(media));
    return '<article class="anime-card sea-media-card" data-media-entry-card-container '+attr+'="'+e(media.id)+'" tabindex="0" role="button" aria-label="Open '+e(title(media))+'">'+
      '<div class="poster-wrap media-entry-card__body" data-media-entry-card-body>'+
      (poster ? '<img data-media-entry-card-body-image loading="lazy" src="'+poster+'" alt="">' : '<div class="poster-fallback">'+e(title(media))+'</div>')+
      '<div class="poster-shade"></div>'+
      (progress > 0 ? '<div class="sea-card-progress" data-media-entry-card-body-progress-bar-container><div data-media-entry-card-body-progress-bar style="width:'+Math.max(0,Math.min(100,Number(progress)||0))+'%"></div></div>' : '')+
      (season ? '<span class="season-chip">'+e(season)+'</span>' : '')+
      (score ? '<span class="poster-score">'+star+' '+e(score)+'</span>' : '')+
      '</div><div class="sea-card-title" data-media-entry-card-title-section><div class="card-title" data-media-entry-card-title-section-title>'+e(title(media))+'</div><p class="card-subtitle" data-media-entry-card-title-section-year-season>'+e([year,episodes].filter(Boolean).join(" · "))+'</p></div>'+
      (resume ? '<div class="card-resume">'+e(resume)+'</div>' : '')+
      '</article>';
  }
  function spotlight(media, {score="",season="",year="",play="",bookmark="",star=""}={}) {
    const poster=safeImage(image(media)), banner=safeImage(media?.bannerImage||image(media));
    const description=plain(media?.description);
    return '<section class="hero-stage home-hero sea-discover-header" data-discover-page-header>'+
      '<div class="hero-bg" data-discover-page-header-banner-image style="background-image:url(&quot;'+banner+'&quot;)"></div>'+
      '<div class="sea-banner-top"></div><div class="sea-banner-bottom"></div>'+
      '<div class="hero-content sea-media-metadata" data-discover-page-header-media-metadata>'+
      (poster ? '<div class="sea-hero-poster"><img src="'+poster+'" alt="" loading="eager"></div>' : '')+
      '<div class="sea-hero-copy"><div class="hero-kicker">Trending on AniDash</div><h1 class="hero-title">'+e(title(media))+'</h1>'+
      '<div class="hero-meta"><span>'+star+' '+e(score)+'</span><span>'+e(season)+'</span><span>'+e(media?.format||"Anime")+'</span><span>'+e(year)+'</span></div>'+
      (description ? '<p class="hero-description">'+e(description)+'</p>' : '')+
      '<div class="hero-actions"><button class="btn btn-primary" data-anime="'+e(media.id)+'">'+play+' Explore Anime</button><button class="btn btn-secondary" data-watchlist="'+e(media.id)+'">'+bookmark+' Save</button></div>'+
      '</div></div></section>';
  }
  // Port of MediaPageHeader / MediaPageHeaderEntryDetails, adapted to the
  // AniDash episode and watchlist action contract, not Seanime server state.
  function entryHeader(media,{score="",year="",watched=false,hasEpisodes=false}={}) {
    const poster=safeImage(image(media)),banner=safeImage(media?.bannerImage||image(media));
    const primary=title(media),alternate=media?.title?.romaji||media?.title?.native||"";
    return '<div class="details-hero sea-entry-header" data-media-page-header><div class="details-banner" data-media-page-header-banner style="background-image:url(&quot;'+banner+'&quot;)"></div><div class="sea-banner-top"></div><div class="sea-banner-bottom"></div>'+
      '<div class="details-content" data-media-page-header-entry-details>'+
      (poster?'<div class="sea-entry-cover" data-media-page-header-entry-details-cover-image-container><img class="details-poster" data-media-page-header-entry-details-cover-image src="'+poster+'" alt="'+e(primary)+'"></div>':'')+
      '<div class="details-copy" data-media-page-header-entry-details-content><div data-media-page-header-entry-details-title-container><h1 class="details-title">'+e(primary)+'</h1>'+
      (alternate&&alternate.toLowerCase()!==primary.toLowerCase()?'<div class="details-native">'+e(alternate)+'</div>':'')+'</div>'+
      '<div class="details-meta" data-media-page-header-entry-details-more-info><span class="meta-chip">★ '+e(score)+'</span><span class="meta-chip">'+e(media.format||"Anime")+'</span><span class="meta-chip">'+e(media.status||"Unknown")+'</span><span class="meta-chip">'+e(media.episodes?media.episodes+" episodes":"Episode count unknown")+'</span><span class="meta-chip">'+e(year)+'</span></div>'+
      '<p class="details-description">'+e(plain(media.description)||"No synopsis is available for this title yet.")+'</p>'+
      '<div class="button-row"><button class="btn btn-primary" data-play-first="'+e(media.id)+'" '+(hasEpisodes?"":"disabled")+'>▶ Start watching</button><button class="btn btn-secondary" data-watchlist="'+e(media.id)+'">'+(watched?"✓ In watchlist":"♡ Add to watchlist")+'</button></div></div></div></div>';
  }
  window.AniDashSeaUI=Object.freeze({card,spotlight,entryHeader});
})();

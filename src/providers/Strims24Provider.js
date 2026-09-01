const BaseProvider = require('./BaseProvider');
const MatchEntity = require('../domain/MatchEntity');
const StreamEntity = require('../domain/StreamEntity');
const { BASE_URL } = require('../config');

class Strims24Provider extends BaseProvider {
  constructor(opts) {
    super(opts);
    this.name = 'Strims24';
    this.baseUrl = 'https://strims24.pl';
    this.flashBase = 'https://1.newsoccers.one/2/x/feed';
    this.flashSign = 'SW9D1eZo';

    this.sports = ['football', 'basketball', 'tennis', 'mma', 'motorsport'];
    
    this.SPORT_FS_ID = {
      football: 1, tennis: 2, basketball: 3, hockey: 4, nfl: 5, baseball: 6,
      handball: 7, futsal: 11, volleyball: 12, cricket: 13, darts: 14,
      snooker: 15, boxing: 16, mma: 28, motorsport: 31, 'winter-sports': 37,
      cycling: 34, golf: 23, waterpolo: 0
    };

    this.fetchData = this.circuitBreaker.wrap(`${this.name}_fetch`, async (url, headers = {}) => {
      const res = await this.proxyFetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP error! status: ${res.status}`);
      return res;
    });
  }

  getTodayDate() {
    return new Date().toISOString().slice(0, 10);
  }

  tviKey(n) {
    return String(n).replace(/^0+(\d)/, "$1");
  }

  parseTvChannels(alField) {
    if (!alField) return [];
    try {
      const parsed = JSON.parse(alField);
      const tvChannels = parsed['1'] || [];
      return tvChannels.filter(ch => ch && ch.TVI).map(ch => this.tviKey(String(ch.TVI)));
    } catch { return []; }
  }

  parseFlashData(text, sport) {
    if (!text) return [];
    const isEventBased = sport === 'motorsport';
    const rows = text.split('~');
    const events = [];
    let currentTournament = null;

    rows.forEach((row, idx) => {
      if (idx === 0 || !row) return;
      const cells = row.split('¬');
      const data = {};
      for (const cell of cells) {
        const [k, v] = cell.split('÷');
        if (k && v != null) data[k] = v;
      }

      if (data.ZA) {
        if (isEventBased && data.ZW !== '1') {
          const zn = (data.ZN || '').split('|');
          const startTime = parseInt(zn[0] || '0', 10);
          events.push({
            id: data.ZC || data.ZEE || `mtr-${idx}`,
            tournamentName: data.ZA,
            homeTeam: '',
            awayTeam: '',
            eventTitle: data.ZA,
            startTime,
            tvChannelIds: []
          });
          currentTournament = null;
          return;
        }

        let leagueName = data.ZA;
        if (data.ZA.includes(':')) {
          const [c, l] = data.ZA.split(':');
          leagueName = l ? l.trim() : data.ZA;
        }
        currentTournament = { name: leagueName };
        return;
      }

      if (data.AA && currentTournament) {
        events.push({
          id: data.AA,
          tournamentName: currentTournament.name,
          homeTeam: data.CX || data.AE || '',
          awayTeam: data.AF || '',
          startTime: parseInt(data.AD || '0', 10),
          tvChannelIds: this.parseTvChannels(data.AL),
          team1Logo: data.OA ? `https://www.flashscore.com/res/image/data/${data.OA}` : null,
          team2Logo: data.OB ? `https://www.flashscore.com/res/image/data/${data.OB}` : null
        });
      }
    });
    return events;
  }

  async fetchFlashscore(sport) {
    const sportId = this.SPORT_FS_ID[sport];
    if (sportId === undefined) return [];
    const prefix = sport === 'motorsport' ? 'fp_' : 'f_';
    
    // Fetch today (0), yesterday (-1), and tomorrow (1) to cover all timezone and ongoing match boundaries
    const days = [0, -1, 1];
    const results = await Promise.allSettled(
      days.map(async (d) => {
        const url = `${this.flashBase}/${prefix}${sportId}_${d}_2_en_1`;
        const res = await this.fetchData.fire(url, { 'x-fsign': this.flashSign, accept: '*/*' });
        if (!res) return [];
        const text = await res.text();
        return this.parseFlashData(text, sport);
      })
    );

    const events = [];
    const seen = new Set();
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        for (const ev of r.value) {
          if (ev && ev.id && !seen.has(ev.id)) {
            seen.add(ev.id);
            events.push(ev);
          }
        }
      }
    }
    return events;
  }

  async fetchStrimsMatches(sport, date) {
    try {
      const url = `${this.baseUrl}/api/v1/${sport}/${date}`;
      const res = await this.fetchData.fire(url);
      if (!res || res.status !== 200) return [];
      const data = await res.json();
      return Array.isArray(data.items) ? data.items : [];
    } catch (e) {
      console.error(`[${this.name}] Failed to fetch matches for ${sport}`, e.message);
      return [];
    }
  }

  async fetchStrimsChannels() {
    try {
      const res = await this.fetchData.fire(`${this.baseUrl}/api/v1/channels`);
      if (!res || res.status !== 200) return {};
      const data = await res.json();
      const arr = Array.isArray(data) ? data : (data && Array.isArray(data.items)) ? data.items : (data && Array.isArray(data.channels)) ? data.channels : [];
      const userChannels = {};
      for (const ch of arr) {
        if (!ch) continue;
        if (ch.FS) {
          const m = ch.FS.match(/TVI(\d+)/);
          if (m) userChannels[this.tviKey(m[1])] = ch;
        }
        if (ch.id != null) userChannels[String(ch.id)] = ch;
      }
      return userChannels;
    } catch (e) {
      console.error(`[${this.name}] Failed to fetch channels`, e.message);
      return {};
    }
  }

  async fetchMatchTvChannelIds(matchId) {
    try {
      const res = await this.fetchData.fire(`${this.flashBase}/df_dos_1_${matchId}_`, { 'x-fsign': this.flashSign, accept: '*/*' });
      if (!res || res.status !== 200) return [];
      const text = await res.text();
      const m = text.match(/AL÷(\{[^¬]+\})/);
      return m ? this.parseTvChannels(m[1]) : [];
    } catch (e) {
      return [];
    }
  }

  async fetchViewers() {
    try {
      const res = await this.fetchData.fire(`${this.baseUrl}/api/v1/viewers`);
      if (res && res.status === 200) return await res.json();
    } catch (e) {}
    return {};
  }

  async pMap(items, fn, concurrency = 25) {
    const results = [];
    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
      while (index < items.length) {
        const i = index++;
        results[i] = await fn(items[i]);
      }
    });
    await Promise.all(workers);
    return results;
  }

  async getMatches() {
    const matches = [];
    try {
      const date = this.getTodayDate();
      const userChannelsPromise = this.fetchStrimsChannels();

      const sportsDataPromises = this.sports.map(async (sport) => {
        const [flashRaw, backendMatches] = await Promise.all([
          this.fetchFlashscore(sport),
          this.fetchStrimsMatches(sport, date)
        ]);
        return { sport, flashRaw, backendMatches };
      });

      const [userChannels, sportsData] = await Promise.all([
        userChannelsPromise,
        Promise.all(sportsDataPromises)
      ]);

      const haveChannels = Object.keys(userChannels).length > 0;
      const now = Date.now();
      const FOUR_HOURS = 4 * 60 * 60 * 1000;

      // Collect all backend match items to check stream availability in parallel
      const allBackendItems = [];
      for (const { sport, backendMatches } of sportsData) {
        for (const it of backendMatches) {
          if (it && typeof it.match_id === 'string') {
            allBackendItems.push({ sport, ...it });
          }
        }
      }

      this.matchDetailsCache = new Map();

      // Verify that matches actually have streams available before including them
      await this.pMap(allBackendItems, async (it) => {
        try {
          const res = await this.fetchData.fire(`${this.baseUrl}/api/v1/match/${it.match_id}`);
          if (res && res.status === 200) {
            const detail = await res.json();
            const hasCu = Array.isArray(detail.custom_urls) && detail.custom_urls.some(c => c && c.enabled !== false);
            const hasCh = Array.isArray(detail.channels) && detail.channels.some(c => c && c.enabled !== false);
            if (hasCu || hasCh) {
              this.matchDetailsCache.set(it.match_id, detail);
            }
          }
        } catch (e) {}
      }, 30);

      for (const { sport, flashRaw, backendMatches } of sportsData) {
        const validFsIds = new Set();
        const validCustomItems = [];

        for (const it of backendMatches) {
          if (typeof it.match_id !== 'string') continue;
          // CRITICAL: Skip any match that does not have streams available!
          if (!this.matchDetailsCache.has(it.match_id)) continue;

          if (it.match_id.startsWith('FS:')) {
            validFsIds.add(it.match_id.replace(/^FS:/, ''));
          } else {
            validCustomItems.push(it);
          }
        }

        const processedFsIds = new Set();

        for (const e of flashRaw) {
          const hasChannelMatch = haveChannels && e.tvChannelIds.some(id => userChannels[id]);
          const isManual = validFsIds.has(e.id);
          
          if (hasChannelMatch || isManual) {
            processedFsIds.add(e.id);
            const title = e.eventTitle || ((e.homeTeam && e.awayTeam) ? `${e.homeTeam} - ${e.awayTeam}` : (e.homeTeam || e.tournamentName));
            
            const kickoff = e.startTime ? e.startTime * 1000 : now;
            const isLive = kickoff <= now && kickoff > now - FOUR_HOURS;
            
            matches.push(new MatchEntity({
              id: `FS:${e.id}`,
              title: title,
              category: this.normalizeCategory(sport),
              date: kickoff.toString(),
              popular: isLive ? '1' : '0',
              league: e.tournamentName,
              team1: { name: e.homeTeam, logo: e.team1Logo },
              team2: { name: e.awayTeam, logo: e.team2Logo },
              sources: [{ source: 'strims24', id: `FS:${e.id}`, original_sport: sport }]
            }));
          }
        }

        // Fallback for valid FS matches not listed in the 3-day Flashscore feed
        for (const fsId of validFsIds) {
          if (!processedFsIds.has(fsId)) {
            const detail = this.matchDetailsCache.get(`FS:${fsId}`);
            const title = detail?.name || `Live Event ${fsId}`;
            matches.push(new MatchEntity({
              id: `FS:${fsId}`,
              title: title,
              category: this.normalizeCategory(sport),
              date: now.toString(),
              popular: '0',
              sources: [{ source: 'strims24', id: `FS:${fsId}`, original_sport: sport }]
            }));
          }
        }

        for (const it of validCustomItems) {
           const kickoff = it.start_ts ? it.start_ts * 1000 : now;
           const isLive = kickoff <= now && kickoff > now - FOUR_HOURS;
           const cleanMatchId = it.match_id ? (it.match_id.startsWith('CUST:') ? it.match_id : `CUST:${it.match_id}`) : `CUST:${Date.now()}`;
           matches.push(new MatchEntity({
              id: cleanMatchId,
              title: it.name || it.match_id,
              category: this.normalizeCategory(sport),
              date: kickoff.toString(),
              popular: isLive ? '1' : '0',
              sources: [{ source: 'strims24', id: cleanMatchId, original_sport: sport }]
            }));
        }
      }

      // Add standalone 24/7 channels as network matches if available
      const addedChannelIds = new Set();
      for (const key of Object.keys(userChannels)) {
        const ch = userChannels[key];
        if (!ch || !ch.id) continue;
        const chIdStr = String(ch.id);
        
        if (addedChannelIds.has(chIdStr)) continue;
        addedChannelIds.add(chIdStr);
        
        matches.push(new MatchEntity({
          id: `CH:${ch.id}`,
          title: ch.name || `Channel ${ch.id}`,
          category: 'networks',
          date: Date.now().toString(),
          popular: '1',
          sources: [{ source: 'strims24', id: `CH:${ch.id}`, original_sport: 'network' }]
        }));
      }

    } catch (e) {
      console.error(`[${this.name}] Error in getMatches:`, e.message);
    }
    return matches;
  }

  async resolveSingleStream(url, name, matchTitle, viewers = 0) {
    let embedUrl = url;
    if (/^[a-f0-9]{32}$/i.test(embedUrl)) {
       embedUrl = `https://iplayer.is/echo/${embedUrl}`;
    } else if (!/^https?:\/\//i.test(embedUrl)) {
       embedUrl = `https://iplayer.is${embedUrl.startsWith('/') ? '' : '/'}${embedUrl}`;
    }

    let directUrl = null;
    let proxyReqHeaders = {
       'Referer': 'https://iplayer.is/'
    };
    
    let premiumSlug = null;
    const premiumUrlMatch = embedUrl.match(/\/premium\/([^?&]+)/);
    if (premiumUrlMatch) {
        premiumSlug = premiumUrlMatch[1];
    } else {
        const socialMatch = embedUrl.match(/\/social\/([a-z0-9-]+)/i);
        if (socialMatch) premiumSlug = socialMatch[1].replace(/-/g, '');
    }

    if (!premiumSlug) {
        try {
            const embedRes = await this.proxyFetch(embedUrl, { headers: { 'Referer': 'https://strims24.pl/' } });
            if (embedRes && embedRes.ok) {
                const embedHtml = await embedRes.text();
                let premiumMatch = embedHtml.match(/src=["']\/premium\/([^"']+)["']/);
                if (!premiumMatch) {
                    premiumMatch = embedHtml.match(/src=["']https:\/\/iplayer\.is\/premium\/([^"']+)["']/);
                }
                
                if (premiumMatch) {
                    premiumSlug = premiumMatch[1];
                } else {
                    const streamUrlMatch = embedHtml.match(/STREAM_URL\s*=\s*["']([^"']+)["']/i);
                    if (streamUrlMatch) {
                        directUrl = streamUrlMatch[1].replace(/\\\//g, '/');
                    } else {
                        const m3u8Match = embedHtml.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
                        if (m3u8Match) {
                            directUrl = m3u8Match[1];
                        }
                    }
                }
            }
        } catch (e) {
            console.warn(`[${this.name}] Failed to extract stream from ${embedUrl}: ${e.message}`);
        }
    }

    if (premiumSlug) {
        try {
            const psignRes = await this.proxyFetch(`https://iplayer.is/psign/${encodeURIComponent(premiumSlug)}`, {
                headers: { 'Referer': `https://iplayer.is/premium/${premiumSlug}`, 'Accept': 'application/json' }
            });
            if (psignRes && psignRes.ok) {
                const psignData = await psignRes.json();
                if (psignData && psignData.url) {
                    directUrl = psignData.url;
                    proxyReqHeaders['Referer'] = 'https://iplayer.is/';
                }
            }
        } catch (e) {
            console.warn(`[${this.name}] Failed to fetch psign for slug ${premiumSlug}: ${e.message}`);
        }
    }

    const viewersText = viewers > 0 ? ` | 👥 ${viewers} Viewers` : '';
    const fullTitle = `${name}${viewersText}`;

    if (directUrl) {
        const proxyUrl = `${BASE_URL}/api/manifest?url=${encodeURIComponent(directUrl)}&referer=${encodeURIComponent(proxyReqHeaders['Referer'] || 'https://iplayer.is/')}&origin=${encodeURIComponent('https://iplayer.is')}`;
        return new StreamEntity({
          name: `Strims24`,
          title: `[Direct] ${fullTitle}`,
          url: proxyUrl,
          behaviorHints: {
            notWebReady: true,
            proxyHeaders: {
              request: proxyReqHeaders
            }
          }
        });
    }

    return new StreamEntity({
      name: `Strims24`,
      title: fullTitle,
      externalUrl: `/watch?url=${encodeURIComponent(embedUrl)}&title=${encodeURIComponent(matchTitle || 'Live Event')}`
    });
  }

  async resolveStream(sourceId, matchCategory, matchTitle) {
    try {
      const normalizedSourceId = String(sourceId).replace(/^(CUST:)+/, 'CUST:').replace(/^(FS:)+/, 'FS:').replace(/^(CH:)+/, 'CH:');
      const isFs = normalizedSourceId.startsWith('FS:');
      const isCh = normalizedSourceId.startsWith('CH:');
      const cleanId = normalizedSourceId.replace(/^(FS:|CUST:|CH:)/, '');

      let dbDetail = null;
      if (!isCh) {
        if (this.matchDetailsCache && this.matchDetailsCache.has(normalizedSourceId)) {
          dbDetail = this.matchDetailsCache.get(normalizedSourceId);
        } else {
          const dbDetailRes = await this.fetchData.fire(`${this.baseUrl}/api/v1/match/${normalizedSourceId}`).catch(() => null);
          if (dbDetailRes && dbDetailRes.status === 200) dbDetail = await dbDetailRes.json();
        }
      }

      const [userChannels, viewersMap] = await Promise.all([
        this.fetchStrimsChannels(),
        this.fetchViewers()
      ]);

      const haveChannels = Object.keys(userChannels).length > 0;
      const matchViewers = viewersMap[cleanId] || viewersMap[sourceId] || 0;

      const channels = [];
      const disabledIds = new Set();
      
      let dbChannels = [];
      if (isCh) {
          dbChannels = [{ id: cleanId, name: 'Network Stream', enabled: true }];
      } else {
          dbChannels = (dbDetail && Array.isArray(dbDetail.channels)) ? dbDetail.channels : [];
      }

      for (const ch of dbChannels) {
        if (ch.enabled === false) {
          const sId = String(ch.id);
          const resolved = userChannels[sId] || userChannels[this.tviKey(sId.replace(/^TVI/, ''))];
          if (resolved) disabledIds.add(String(resolved.id));
        }
      }

      for (const ch of dbChannels) {
        if (ch.enabled === false) continue;
        const sId = String(ch.id);
        const resolved = userChannels[sId] || userChannels[this.tviKey(sId.replace(/^TVI/, ''))];
        if (resolved) {
          channels.push({ id: resolved.id, name: resolved.name || ch.name });
        } else if (isCh || ch.id) {
          channels.push({ id: ch.id, name: ch.name || `Channel ${ch.id}` });
        }
      }

      if (isFs && haveChannels) {
        const feedTviIds = await this.fetchMatchTvChannelIds(cleanId);
        for (const tviId of feedTviIds) {
          const ch = userChannels[tviId];
          if (!ch) continue;
          if (disabledIds.has(String(ch.id))) continue;
          channels.push({ id: ch.id, name: ch.name });
        }
      }

      const seen = new Set();
      const uniqueChannels = channels.filter(c => {
        const k = String(c.id);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      const streamPromises = [];

      for (const ch of uniqueChannels) {
        const embedUrl = `https://iplayer.is/player/lean/${encodeURIComponent(ch.id)}`;
        const v = viewersMap[String(ch.id)] || matchViewers || 0;
        streamPromises.push(this.resolveSingleStream(embedUrl, ch.name || `Channel ${ch.id}`, matchTitle, v));
      }

      if (dbDetail && Array.isArray(dbDetail.custom_urls)) {
        for (const cu of dbDetail.custom_urls) {
          if (cu.enabled === false) continue;
          const v = cu.viewers || viewersMap[cu.id] || matchViewers || 0;
          streamPromises.push(this.resolveSingleStream(cu.url, cu.name || `Custom ${cu.id}`, matchTitle, v));
        }
      }

      const resolvedStreams = await Promise.all(streamPromises);
      return resolvedStreams.filter(Boolean);
    } catch (e) {
      console.error(`[${this.name}] resolveStream failed for ${sourceId}:`, e.message);
      return [];
    }
  }
}

module.exports = Strims24Provider;

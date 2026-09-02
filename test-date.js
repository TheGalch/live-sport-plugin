const container = require("./src/container.js");

(async () => {
    const agg = container.resolve("matchAggregator");
    const strims = container.resolve("strims24Provider");
    const matches = await strims.getMatches();
    const omonia = matches.find(m => m.title && m.title.includes("Omonia"));
    console.log("Omonia raw match:", omonia);
    console.log("Date now:", Date.now());
    console.log("Match date num:", Number(omonia.date));
    console.log("Diff in hours:", (Number(omonia.date) - Date.now()) / (3600 * 1000));
    
    // Now let us run aggregator.syncMatches() and see if it ends up in cacheService
    await agg.syncMatches();
    const cache = container.resolve("cacheService");
    const cachedOmonia = cache.getMatches().find(m => m.title && m.title.includes("Omonia"));
    console.log("In cache after sync?", !!cachedOmonia, cachedOmonia);
    
    // Check if it passes handleCatalog filters in catalog.js
    const catalogHandler = require("./src/catalog.js");
    const cat = await catalogHandler.handleCatalog("tv", "nuvio_sports_all", {}, {});
    const inCat = (cat.metas || []).find(m => m.name && m.name.includes("Omonia"));
    console.log("In handleCatalog nuvio_sports_all?", !!inCat, inCat);

    // Check handleStream in streams.js
    if (cachedOmonia) {
        const streamsHandler = require("./src/streams.js");
        const streamRes = await streamsHandler.handleStream("tv", cachedOmonia.id, {});
        console.log("handleStream result:", JSON.stringify(streamRes, null, 2));
    }
})();

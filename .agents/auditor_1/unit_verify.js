const { getRequestBaseUrl, getLocalIp } = require('../../src/config');
const imageService = require('../../src/services/ImageService');

console.log('--- Test 1: getRequestBaseUrl ---');
const req1 = { headers: { 'x-forwarded-proto': 'https', 'host': 'addon.ngrok.app' } };
console.log('req1:', getRequestBaseUrl(req1) === 'https://addon.ngrok.app' ? 'PASS' : 'FAIL', `(${getRequestBaseUrl(req1)})`);

const req2 = { headers: { 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'domain.org, proxy.org', 'host': 'internal' } };
console.log('req2:', getRequestBaseUrl(req2) === 'https://domain.org' ? 'PASS' : 'FAIL', `(${getRequestBaseUrl(req2)})`);

const req3 = { headers: { 'cf-visitor': '{"scheme":"https"}', 'host': 'cf.domain.com' } };
console.log('req3:', getRequestBaseUrl(req3) === 'https://cf.domain.com' ? 'PASS' : 'FAIL', `(${getRequestBaseUrl(req3)})`);

const req4 = { headers: { 'x-forwarded-ssl': 'on', 'host': 'ssl.domain.com' } };
console.log('req4:', getRequestBaseUrl(req4) === 'https://ssl.domain.com' ? 'PASS' : 'FAIL', `(${getRequestBaseUrl(req4)})`);

console.log('--- Test 2: normalizeUrl ---');
console.log('norm1:', imageService.normalizeUrl('//streamed.pk/img.png') === 'https://streamed.pk/img.png' ? 'PASS' : 'FAIL');
console.log('norm2:', imageService.normalizeUrl('   https://example.com/logo.jpg   ') === 'https://example.com/logo.jpg' ? 'PASS' : 'FAIL');
console.log('norm3:', imageService.normalizeUrl('javascript:alert(1)') === null ? 'PASS' : 'FAIL');
console.log('norm4:', imageService.normalizeUrl('') === null ? 'PASS' : 'FAIL');

console.log('--- Test 3: svgPlaceholder ---');
const svg = imageService.svgPlaceholder('Arsenal\nvs\nChelsea', '10b981');
console.log('svg valid:', svg.includes('<svg') && svg.includes('#10b981') && svg.includes('Arsenal') ? 'PASS' : 'FAIL');

console.log('--- Test 4: getLocalIp ---');
const ip = getLocalIp();
console.log('local ip:', ip, /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) ? 'PASS' : 'FAIL');

/*
 * Generador de QR en SVG, sin dependencias.
 * Codificador QR basado en la implementación de dominio público de Nayuki
 * (QR Code generator library), adaptado a un único archivo para Node.
 *
 * Uso: node generar-qr.js "EMP-001" qr-richard-siza.svg
 */

"use strict";

/* ===== Núcleo del codificador QR (dominio público, Project Nayuki) ===== */
var qrcodegen = (function () {
  function QrCode(version, errorCorrectionLevel, dataCodewords, msk) {
    this.version = version;
    this.errorCorrectionLevel = errorCorrectionLevel;
    this.size = version * 4 + 17;
    this.modules = [];
    this.isFunction = [];
    for (var i = 0; i < this.size; i++) {
      this.modules.push(new Array(this.size).fill(false));
      this.isFunction.push(new Array(this.size).fill(false));
    }
    this.drawFunctionPatterns();
    var allCodewords = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);
    if (msk == -1) {
      var minPenalty = 1000000000;
      for (var i = 0; i < 8; i++) {
        this.applyMask(i);
        this.drawFormatBits(i);
        var penalty = this.getPenaltyScore();
        if (penalty < minPenalty) {
          msk = i;
          minPenalty = penalty;
        }
        this.applyMask(i);
      }
    }
    this.mask = msk;
    this.applyMask(msk);
    this.drawFormatBits(msk);
    this.isFunction = [];
  }

  QrCode.prototype.getModule = function (x, y) {
    return 0 <= x && x < this.size && 0 <= y && y < this.size && this.modules[y][x];
  };

  QrCode.prototype.drawFunctionPatterns = function () {
    for (var i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 == 0);
      this.setFunctionModule(i, 6, i % 2 == 0);
    }
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);
    var alignPatPos = this.getAlignmentPatternPositions();
    var numAlign = alignPatPos.length;
    for (var i = 0; i < numAlign; i++) {
      for (var j = 0; j < numAlign; j++) {
        if (!(i == 0 && j == 0 || i == 0 && j == numAlign - 1 || i == numAlign - 1 && j == 0))
          this.drawAlignmentPattern(alignPatPos[i], alignPatPos[j]);
      }
    }
    this.drawFormatBits(0);
    this.drawVersion();
  };

  QrCode.prototype.drawFormatBits = function (msk) {
    var data = (this.errorCorrectionLevel.formatBits << 3) | msk;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    for (var i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (var i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));
    for (var i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (var i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true);
  };

  QrCode.prototype.drawVersion = function () {
    if (this.version < 7) return;
    var rem = this.version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    var bits = (this.version << 12) | rem;
    for (var i = 0; i < 18; i++) {
      var bit = getBit(bits, i);
      var a = this.size - 11 + (i % 3);
      var b = Math.floor(i / 3);
      this.setFunctionModule(a, b, bit);
      this.setFunctionModule(b, a, bit);
    }
  };

  QrCode.prototype.drawFinderPattern = function (x, y) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        var xx = x + dx, yy = y + dy;
        if (0 <= xx && xx < this.size && 0 <= yy && yy < this.size)
          this.setFunctionModule(xx, yy, dist != 2 && dist != 4);
      }
    }
  };

  QrCode.prototype.drawAlignmentPattern = function (x, y) {
    for (var dy = -2; dy <= 2; dy++)
      for (var dx = -2; dx <= 2; dx++)
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) != 1);
  };

  QrCode.prototype.setFunctionModule = function (x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  };

  QrCode.prototype.addEccAndInterleave = function (data) {
    var ver = this.version;
    var ecl = this.errorCorrectionLevel;
    var numBlocks = QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
    var blockEccLen = QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver];
    var rawCodewords = Math.floor(QrCode.getNumRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);
    var blocks = [];
    var rsDiv = QrCode.reedSolomonComputeDivisor(blockEccLen);
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      var ecc = QrCode.reedSolomonComputeRemainder(dat, rsDiv);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var result = [];
    for (var i = 0; i < blocks[0].length; i++) {
      for (var j = 0; j < blocks.length; j++) {
        if (i != shortBlockLen - blockEccLen || j >= numShortBlocks)
          result.push(blocks[j][i]);
      }
    }
    return result;
  };

  QrCode.prototype.drawCodewords = function (data) {
    var i = 0;
    for (var right = this.size - 1; right >= 1; right -= 2) {
      if (right == 6) right = 5;
      for (var vert = 0; vert < this.size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) == 0;
          var y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  };

  QrCode.prototype.applyMask = function (msk) {
    for (var y = 0; y < this.size; y++) {
      for (var x = 0; x < this.size; x++) {
        var invert;
        switch (msk) {
          case 0: invert = (x + y) % 2 == 0; break;
          case 1: invert = y % 2 == 0; break;
          case 2: invert = x % 3 == 0; break;
          case 3: invert = (x + y) % 3 == 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 == 0; break;
          case 5: invert = x * y % 2 + x * y % 3 == 0; break;
          case 6: invert = (x * y % 2 + x * y % 3) % 2 == 0; break;
          case 7: invert = ((x + y) % 2 + x * y % 3) % 2 == 0; break;
        }
        if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  };

  QrCode.prototype.getPenaltyScore = function () {
    var result = 0;
    var size = this.size;
    var modules = this.modules;
    for (var y = 0; y < size; y++) {
      var runColor = false, runX = 0, runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (var x = 0; x < size; x++) {
        if (modules[y][x] == runColor) {
          runX++;
          if (runX == 5) result += 3;
          else if (runX > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runX, runHistory);
          if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * 40;
          runColor = modules[y][x];
          runX = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runX, runHistory) * 40;
    }
    for (var x = 0; x < size; x++) {
      var runColor = false, runY = 0, runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (var y = 0; y < size; y++) {
        if (modules[y][x] == runColor) {
          runY++;
          if (runY == 5) result += 3;
          else if (runY > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runY, runHistory);
          if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * 40;
          runColor = modules[y][x];
          runY = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runY, runHistory) * 40;
    }
    for (var y = 0; y < size - 1; y++) {
      for (var x = 0; x < size - 1; x++) {
        var color = modules[y][x];
        if (color == modules[y][x + 1] && color == modules[y + 1][x] && color == modules[y + 1][x + 1])
          result += 3;
      }
    }
    var dark = 0;
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (modules[y][x]) dark++;
    var total = size * size;
    var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * 10;
    return result;
  };

  QrCode.prototype.getAlignmentPatternPositions = function () {
    if (this.version == 1) return [];
    var numAlign = Math.floor(this.version / 7) + 2;
    var step = (this.version == 32) ? 26 :
      Math.ceil((this.version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = this.size - 7; result.length < numAlign; pos -= step)
      result.splice(1, 0, pos);
    return result;
  };

  QrCode.getNumRawDataModules = function (ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  };

  QrCode.reedSolomonComputeDivisor = function (degree) {
    var result = [];
    for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < result.length; j++) {
        result[j] = QrCode.reedSolomonMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = QrCode.reedSolomonMultiply(root, 0x02);
    }
    return result;
  };

  QrCode.reedSolomonComputeRemainder = function (data, divisor) {
    var result = divisor.map(function () { return 0; });
    data.forEach(function (b) {
      var factor = b ^ result.shift();
      result.push(0);
      divisor.forEach(function (coef, i) {
        result[i] ^= QrCode.reedSolomonMultiply(coef, factor);
      });
    });
    return result;
  };

  QrCode.reedSolomonMultiply = function (x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  };

  QrCode.prototype.finderPenaltyCountPatterns = function (runHistory) {
    var n = runHistory[1];
    var core = n > 0 && runHistory[2] == n && runHistory[3] == n * 3 && runHistory[4] == n && runHistory[5] == n;
    return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0)
      + (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
  };

  QrCode.prototype.finderPenaltyTerminateAndCount = function (currentRunColor, currentRunLength, runHistory) {
    if (currentRunColor) {
      this.finderPenaltyAddHistory(currentRunLength, runHistory);
      currentRunLength = 0;
    }
    currentRunLength += this.size;
    this.finderPenaltyAddHistory(currentRunLength, runHistory);
    return this.finderPenaltyCountPatterns(runHistory);
  };

  QrCode.prototype.finderPenaltyAddHistory = function (currentRunLength, runHistory) {
    if (runHistory[0] == 0) currentRunLength += this.size;
    runHistory.pop();
    runHistory.unshift(currentRunLength);
  };

  function getBit(x, i) { return ((x >>> i) & 1) != 0; }

  QrCode.encodeText = function (text, ecl) {
    var segs = QrSegment.makeSegments(text);
    return QrCode.encodeSegments(segs, ecl);
  };

  QrCode.encodeSegments = function (segs, ecl, minVersion, maxVersion, mask, boostEcl) {
    minVersion = minVersion || 1;
    maxVersion = maxVersion || 40;
    mask = (mask === undefined) ? -1 : mask;
    boostEcl = (boostEcl === undefined) ? true : boostEcl;
    var version, dataUsedBits;
    for (version = minVersion; ; version++) {
      var dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
      var usedBits = QrSegment.getTotalBits(segs, version);
      if (usedBits <= dataCapacityBits) { dataUsedBits = usedBits; break; }
      if (version >= maxVersion) throw new RangeError("Data too long");
    }
    for (var _i = 0, _a = [QrCode.Ecc.MEDIUM, QrCode.Ecc.QUARTILE, QrCode.Ecc.HIGH]; _i < _a.length; _i++) {
      var newEcl = _a[_i];
      if (boostEcl && dataUsedBits <= QrCode.getNumDataCodewords(version, newEcl) * 8) ecl = newEcl;
    }
    var bb = [];
    segs.forEach(function (seg) {
      appendBits(seg.mode.modeBits, 4, bb);
      appendBits(seg.numChars, seg.mode.numCharCountBits(version), bb);
      seg.getData().forEach(function (b) { bb.push(b); });
    });
    var dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
    appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
    appendBits(0, (8 - bb.length % 8) % 8, bb);
    for (var padByte = 0xec; bb.length < dataCapacityBits; padByte ^= 0xec ^ 0x11)
      appendBits(padByte, 8, bb);
    var dataCodewords = [];
    while (dataCodewords.length * 8 < bb.length) dataCodewords.push(0);
    bb.forEach(function (b, i) { dataCodewords[i >>> 3] |= b << (7 - (i & 7)); });
    return new QrCode(version, ecl, dataCodewords, mask);
  };

  QrCode.getNumDataCodewords = function (ver, ecl) {
    return Math.floor(QrCode.getNumRawDataModules(ver) / 8)
      - QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver]
      * QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
  };

  function appendBits(val, len, bb) {
    for (var i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
  }

  QrCode.ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  QrCode.NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];

  function Ecc(ordinal, formatBits) {
    this.ordinal = ordinal;
    this.formatBits = formatBits;
  }
  QrCode.Ecc = {
    LOW: new Ecc(0, 1),
    MEDIUM: new Ecc(1, 0),
    QUARTILE: new Ecc(2, 3),
    HIGH: new Ecc(3, 2),
  };

  function QrSegment(mode, numChars, bitData) {
    this.mode = mode;
    this.numChars = numChars;
    this.bitData = bitData.slice();
  }
  QrSegment.prototype.getData = function () { return this.bitData.slice(); };

  QrSegment.makeBytes = function (data) {
    var bb = [];
    data.forEach(function (b) { appendBits(b, 8, bb); });
    return new QrSegment(QrSegment.Mode.BYTE, data.length, bb);
  };

  QrSegment.makeSegments = function (text) {
    if (text == "") return [];
    // Codificación byte (UTF-8) para máxima compatibilidad
    var bytes = [];
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) { bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f)); }
      else { bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)); }
    }
    return [QrSegment.makeBytes(bytes)];
  };

  QrSegment.getTotalBits = function (segs, version) {
    var result = 0;
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      var ccbits = seg.mode.numCharCountBits(version);
      if (seg.numChars >= (1 << ccbits)) return Infinity;
      result += 4 + ccbits + seg.bitData.length;
    }
    return result;
  };

  function Mode(modeBits, ccbits) {
    this.modeBits = modeBits;
    this.ccbits = ccbits;
  }
  Mode.prototype.numCharCountBits = function (ver) {
    return this.ccbits[Math.floor((ver + 7) / 17)];
  };
  QrSegment.Mode = {
    BYTE: new Mode(0x4, [8, 16, 16]),
  };

  return { QrCode: QrCode, QrSegment: QrSegment };
})();

/* ===== Generación del SVG ===== */
function toSvgString(qr, border, lightColor, darkColor) {
  var parts = [];
  for (var y = 0; y < qr.size; y++) {
    for (var x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y))
        parts.push("M" + (x + border) + "," + (y + border) + "h1v1h-1z");
    }
  }
  var dim = qr.size + border * 2;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ' + dim + " " + dim + '" stroke="none">\n' +
    '\t<rect width="100%" height="100%" fill="' + lightColor + '"/>\n' +
    '\t<path d="' + parts.join(" ") + '" fill="' + darkColor + '"/>\n' +
    "</svg>\n"
  );
}

/* ===== Main ===== */
/*
 * Genera QR SEGUROS con un token firmado para dificultar la duplicación/falsificación.
 *
 * El QR contiene un JSON compacto:
 *   { "n": nombre, "id": identificador, "nc": nonce, "sig": firma }
 * donde "sig" = HMAC-SHA256( id + "|" + nombre + "|" + nonce , CLAVE_SECRETA )
 * truncado. Sin la clave secreta no se puede fabricar un QR válido nuevo.
 *
 * El par (id + nonce) es único por QR, lo que permite a la app/Google Sheets
 * detectar si un mismo QR se usa repetidamente.
 *
 * Uso:
 *   node generar-qr.js "Richard Siza" "EMP-001" "qr-richard-siza.svg"
 *   node generar-qr.js "<nombre>" "<id>" "<archivo.svg>"
 *
 * IMPORTANTE: la CLAVE_SECRETA debe ser la MISMA que uses en el frontend (app.js)
 * y en Google Apps Script para validar los QR.
 */

var fs = require("fs");
var crypto = require("crypto");

// >>> CAMBIA ESTA CLAVE por una tuya, larga y secreta. Debe coincidir en app.js y Apps Script. <<<
var CLAVE_SECRETA = "CAMBIA-ESTA-CLAVE-SECRETA-2024-xyz987";

var nombre = process.argv[2] || "Richard Siza";
var id = process.argv[3] || "EMP-001";
var outFile = process.argv[4] || "qr-" + id.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".svg";

// Nonce aleatorio robusto (hace el contenido del QR largo y difícil de adivinar)
var nonce = crypto.randomBytes(12).toString("hex");

// Firma HMAC-SHA256 truncada a 24 hex (96 bits): suficiente y mantiene el QR manejable
var base = id + "|" + nombre + "|" + nonce;
var sig = crypto.createHmac("sha256", CLAVE_SECRETA).update(base).digest("hex").slice(0, 24);

var payload = JSON.stringify({ n: nombre, id: id, nc: nonce, sig: sig });

// errorCorrectionLevel Q = mejor tolerancia; el payload es más largo así que sube la versión
var qr = qrcodegen.QrCode.encodeText(payload, qrcodegen.QrCode.Ecc.QUARTILE);
var svg = toSvgString(qr, 4, "#FFFFFF", "#000000");
fs.writeFileSync(outFile, svg);

console.log("QR SEGURO generado");
console.log("  Nombre : " + nombre);
console.log("  ID     : " + id);
console.log("  Nonce  : " + nonce);
console.log("  Sig    : " + sig);
console.log("  Archivo: " + outFile + " (" + qr.size + "x" + qr.size + " modulos)");
console.log("  Payload: " + payload);

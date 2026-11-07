/**
 * Name tables for embedding substitutes of the standard 14 fonts (pdfa-fonts.js), taken from
 * PDF.js (Apache-2.0): CFF standard strings (CFF spec, Appendix A) and the WinAnsi, Standard, Symbol
 * and ZapfDingbats encodings (ISO 32000-1, Annex D). Encodings are stored as space-separated `code:name` pairs.
 */
const table = (pairs) => {
  const names = Array(256).fill('');
  for (const pair of pairs.trim().split(' ')) {
    const at = pair.indexOf(':');
    names[Number(pair.slice(0, at))] = pair.slice(at + 1);
  }
  return names;
};
export const CFF_STANDARD_STRINGS = (
  '.notdef space exclam quotedbl numbersign dollar percent ampersand quoteright parenleft ' +
  'parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight ' +
  'nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V ' +
  'W X Y Z bracketleft backslash bracketright asciicircum underscore quoteleft a b c d e f g h i j ' +
  'k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde exclamdown cent sterling ' +
  'fraction yen florin section currency quotesingle quotedblleft guillemotleft guilsinglleft ' +
  'guilsinglright fi fl endash dagger daggerdbl periodcentered paragraph bullet quotesinglbase ' +
  'quotedblbase quotedblright guillemotright ellipsis perthousand questiondown grave acute ' +
  'circumflex tilde macron breve dotaccent dieresis ring cedilla hungarumlaut ogonek caron emdash ' +
  'AE ordfeminine Lslash Oslash OE ordmasculine ae dotlessi lslash oslash oe germandbls onesuperior ' +
  'logicalnot mu trademark Eth onehalf plusminus Thorn onequarter divide brokenbar degree thorn ' +
  'threequarters twosuperior registered minus eth multiply threesuperior copyright Aacute ' +
  'Acircumflex Adieresis Agrave Aring Atilde Ccedilla Eacute Ecircumflex Edieresis Egrave Iacute ' +
  'Icircumflex Idieresis Igrave Ntilde Oacute Ocircumflex Odieresis Ograve Otilde Scaron Uacute ' +
  'Ucircumflex Udieresis Ugrave Yacute Ydieresis Zcaron aacute acircumflex adieresis agrave aring ' +
  'atilde ccedilla eacute ecircumflex edieresis egrave iacute icircumflex idieresis igrave ntilde ' +
  'oacute ocircumflex odieresis ograve otilde scaron uacute ucircumflex udieresis ugrave yacute ' +
  'ydieresis zcaron exclamsmall Hungarumlautsmall dollaroldstyle dollarsuperior ampersandsmall ' +
  'Acutesmall parenleftsuperior parenrightsuperior twodotenleader onedotenleader zerooldstyle ' +
  'oneoldstyle twooldstyle threeoldstyle fouroldstyle fiveoldstyle sixoldstyle sevenoldstyle ' +
  'eightoldstyle nineoldstyle commasuperior threequartersemdash periodsuperior questionsmall ' +
  'asuperior bsuperior centsuperior dsuperior esuperior isuperior lsuperior msuperior nsuperior ' +
  'osuperior rsuperior ssuperior tsuperior ff ffi ffl parenleftinferior parenrightinferior ' +
  'Circumflexsmall hyphensuperior Gravesmall Asmall Bsmall Csmall Dsmall Esmall Fsmall Gsmall ' +
  'Hsmall Ismall Jsmall Ksmall Lsmall Msmall Nsmall Osmall Psmall Qsmall Rsmall Ssmall Tsmall ' +
  'Usmall Vsmall Wsmall Xsmall Ysmall Zsmall colonmonetary onefitted rupiah Tildesmall ' +
  'exclamdownsmall centoldstyle Lslashsmall Scaronsmall Zcaronsmall Dieresissmall Brevesmall ' +
  'Caronsmall Dotaccentsmall Macronsmall figuredash hypheninferior Ogoneksmall Ringsmall ' +
  'Cedillasmall questiondownsmall oneeighth threeeighths fiveeighths seveneighths onethird ' +
  'twothirds zerosuperior foursuperior fivesuperior sixsuperior sevensuperior eightsuperior ' +
  'ninesuperior zeroinferior oneinferior twoinferior threeinferior fourinferior fiveinferior ' +
  'sixinferior seveninferior eightinferior nineinferior centinferior dollarinferior periodinferior ' +
  'commainferior Agravesmall Aacutesmall Acircumflexsmall Atildesmall Adieresissmall Aringsmall ' +
  'AEsmall Ccedillasmall Egravesmall Eacutesmall Ecircumflexsmall Edieresissmall Igravesmall ' +
  'Iacutesmall Icircumflexsmall Idieresissmall Ethsmall Ntildesmall Ogravesmall Oacutesmall ' +
  'Ocircumflexsmall Otildesmall Odieresissmall OEsmall Oslashsmall Ugravesmall Uacutesmall ' +
  'Ucircumflexsmall Udieresissmall Yacutesmall Thornsmall Ydieresissmall 001.000 001.001 001.002 ' +
  '001.003 Black Bold Book Light Medium Regular Roman Semibold '
)
  .trim()
  .split(' ');
export const WIN_ANSI_ENCODING = table(
  '32:space 33:exclam 34:quotedbl 35:numbersign 36:dollar 37:percent 38:ampersand 39:quotesingle ' +
    '40:parenleft 41:parenright 42:asterisk 43:plus 44:comma 45:hyphen 46:period 47:slash 48:zero ' +
    '49:one 50:two 51:three 52:four 53:five 54:six 55:seven 56:eight 57:nine 58:colon 59:semicolon ' +
    '60:less 61:equal 62:greater 63:question 64:at 65:A 66:B 67:C 68:D 69:E 70:F 71:G 72:H 73:I 74:J ' +
    '75:K 76:L 77:M 78:N 79:O 80:P 81:Q 82:R 83:S 84:T 85:U 86:V 87:W 88:X 89:Y 90:Z 91:bracketleft ' +
    '92:backslash 93:bracketright 94:asciicircum 95:underscore 96:grave 97:a 98:b 99:c 100:d 101:e ' +
    '102:f 103:g 104:h 105:i 106:j 107:k 108:l 109:m 110:n 111:o 112:p 113:q 114:r 115:s 116:t 117:u ' +
    '118:v 119:w 120:x 121:y 122:z 123:braceleft 124:bar 125:braceright 126:asciitilde 127:bullet ' +
    '128:Euro 129:bullet 130:quotesinglbase 131:florin 132:quotedblbase 133:ellipsis 134:dagger ' +
    '135:daggerdbl 136:circumflex 137:perthousand 138:Scaron 139:guilsinglleft 140:OE 141:bullet ' +
    '142:Zcaron 143:bullet 144:bullet 145:quoteleft 146:quoteright 147:quotedblleft 148:quotedblright ' +
    '149:bullet 150:endash 151:emdash 152:tilde 153:trademark 154:scaron 155:guilsinglright 156:oe ' +
    '157:bullet 158:zcaron 159:Ydieresis 160:space 161:exclamdown 162:cent 163:sterling 164:currency ' +
    '165:yen 166:brokenbar 167:section 168:dieresis 169:copyright 170:ordfeminine 171:guillemotleft ' +
    '172:logicalnot 173:hyphen 174:registered 175:macron 176:degree 177:plusminus 178:twosuperior ' +
    '179:threesuperior 180:acute 181:mu 182:paragraph 183:periodcentered 184:cedilla 185:onesuperior ' +
    '186:ordmasculine 187:guillemotright 188:onequarter 189:onehalf 190:threequarters ' +
    '191:questiondown 192:Agrave 193:Aacute 194:Acircumflex 195:Atilde 196:Adieresis 197:Aring 198:AE ' +
    '199:Ccedilla 200:Egrave 201:Eacute 202:Ecircumflex 203:Edieresis 204:Igrave 205:Iacute ' +
    '206:Icircumflex 207:Idieresis 208:Eth 209:Ntilde 210:Ograve 211:Oacute 212:Ocircumflex ' +
    '213:Otilde 214:Odieresis 215:multiply 216:Oslash 217:Ugrave 218:Uacute 219:Ucircumflex ' +
    '220:Udieresis 221:Yacute 222:Thorn 223:germandbls 224:agrave 225:aacute 226:acircumflex ' +
    '227:atilde 228:adieresis 229:aring 230:ae 231:ccedilla 232:egrave 233:eacute 234:ecircumflex ' +
    '235:edieresis 236:igrave 237:iacute 238:icircumflex 239:idieresis 240:eth 241:ntilde 242:ograve ' +
    '243:oacute 244:ocircumflex 245:otilde 246:odieresis 247:divide 248:oslash 249:ugrave 250:uacute ' +
    '251:ucircumflex 252:udieresis 253:yacute 254:thorn 255:ydieresis ',
);
export const STANDARD_ENCODING = table(
  '32:space 33:exclam 34:quotedbl 35:numbersign 36:dollar 37:percent 38:ampersand 39:quoteright ' +
    '40:parenleft 41:parenright 42:asterisk 43:plus 44:comma 45:hyphen 46:period 47:slash 48:zero ' +
    '49:one 50:two 51:three 52:four 53:five 54:six 55:seven 56:eight 57:nine 58:colon 59:semicolon ' +
    '60:less 61:equal 62:greater 63:question 64:at 65:A 66:B 67:C 68:D 69:E 70:F 71:G 72:H 73:I 74:J ' +
    '75:K 76:L 77:M 78:N 79:O 80:P 81:Q 82:R 83:S 84:T 85:U 86:V 87:W 88:X 89:Y 90:Z 91:bracketleft ' +
    '92:backslash 93:bracketright 94:asciicircum 95:underscore 96:quoteleft 97:a 98:b 99:c 100:d ' +
    '101:e 102:f 103:g 104:h 105:i 106:j 107:k 108:l 109:m 110:n 111:o 112:p 113:q 114:r 115:s 116:t ' +
    '117:u 118:v 119:w 120:x 121:y 122:z 123:braceleft 124:bar 125:braceright 126:asciitilde ' +
    '161:exclamdown 162:cent 163:sterling 164:fraction 165:yen 166:florin 167:section 168:currency ' +
    '169:quotesingle 170:quotedblleft 171:guillemotleft 172:guilsinglleft 173:guilsinglright 174:fi ' +
    '175:fl 177:endash 178:dagger 179:daggerdbl 180:periodcentered 182:paragraph 183:bullet ' +
    '184:quotesinglbase 185:quotedblbase 186:quotedblright 187:guillemotright 188:ellipsis ' +
    '189:perthousand 191:questiondown 193:grave 194:acute 195:circumflex 196:tilde 197:macron ' +
    '198:breve 199:dotaccent 200:dieresis 202:ring 203:cedilla 205:hungarumlaut 206:ogonek 207:caron ' +
    '208:emdash 225:AE 227:ordfeminine 232:Lslash 233:Oslash 234:OE 235:ordmasculine 241:ae ' +
    '245:dotlessi 248:lslash 249:oslash 250:oe 251:germandbls ',
);
export const SYMBOL_ENCODING = table(
  '32:space 33:exclam 34:universal 35:numbersign 36:existential 37:percent 38:ampersand 39:suchthat ' +
    '40:parenleft 41:parenright 42:asteriskmath 43:plus 44:comma 45:minus 46:period 47:slash 48:zero ' +
    '49:one 50:two 51:three 52:four 53:five 54:six 55:seven 56:eight 57:nine 58:colon 59:semicolon ' +
    '60:less 61:equal 62:greater 63:question 64:congruent 65:Alpha 66:Beta 67:Chi 68:Delta 69:Epsilon ' +
    '70:Phi 71:Gamma 72:Eta 73:Iota 74:theta1 75:Kappa 76:Lambda 77:Mu 78:Nu 79:Omicron 80:Pi ' +
    '81:Theta 82:Rho 83:Sigma 84:Tau 85:Upsilon 86:sigma1 87:Omega 88:Xi 89:Psi 90:Zeta ' +
    '91:bracketleft 92:therefore 93:bracketright 94:perpendicular 95:underscore 96:radicalex 97:alpha ' +
    '98:beta 99:chi 100:delta 101:epsilon 102:phi 103:gamma 104:eta 105:iota 106:phi1 107:kappa ' +
    '108:lambda 109:mu 110:nu 111:omicron 112:pi 113:theta 114:rho 115:sigma 116:tau 117:upsilon ' +
    '118:omega1 119:omega 120:xi 121:psi 122:zeta 123:braceleft 124:bar 125:braceright 126:similar ' +
    '160:Euro 161:Upsilon1 162:minute 163:lessequal 164:fraction 165:infinity 166:florin 167:club ' +
    '168:diamond 169:heart 170:spade 171:arrowboth 172:arrowleft 173:arrowup 174:arrowright ' +
    '175:arrowdown 176:degree 177:plusminus 178:second 179:greaterequal 180:multiply 181:proportional ' +
    '182:partialdiff 183:bullet 184:divide 185:notequal 186:equivalence 187:approxequal 188:ellipsis ' +
    '189:arrowvertex 190:arrowhorizex 191:carriagereturn 192:aleph 193:Ifraktur 194:Rfraktur ' +
    '195:weierstrass 196:circlemultiply 197:circleplus 198:emptyset 199:intersection 200:union ' +
    '201:propersuperset 202:reflexsuperset 203:notsubset 204:propersubset 205:reflexsubset ' +
    '206:element 207:notelement 208:angle 209:gradient 210:registerserif 211:copyrightserif ' +
    '212:trademarkserif 213:product 214:radical 215:dotmath 216:logicalnot 217:logicaland ' +
    '218:logicalor 219:arrowdblboth 220:arrowdblleft 221:arrowdblup 222:arrowdblright ' +
    '223:arrowdbldown 224:lozenge 225:angleleft 226:registersans 227:copyrightsans 228:trademarksans ' +
    '229:summation 230:parenlefttp 231:parenleftex 232:parenleftbt 233:bracketlefttp ' +
    '234:bracketleftex 235:bracketleftbt 236:bracelefttp 237:braceleftmid 238:braceleftbt 239:braceex ' +
    '241:angleright 242:integral 243:integraltp 244:integralex 245:integralbt 246:parenrighttp ' +
    '247:parenrightex 248:parenrightbt 249:bracketrighttp 250:bracketrightex 251:bracketrightbt ' +
    '252:bracerighttp 253:bracerightmid 254:bracerightbt ',
);
export const ZAPF_DINGBATS_ENCODING = table(
  '32:space 33:a1 34:a2 35:a202 36:a3 37:a4 38:a5 39:a119 40:a118 41:a117 42:a11 43:a12 44:a13 ' +
    '45:a14 46:a15 47:a16 48:a105 49:a17 50:a18 51:a19 52:a20 53:a21 54:a22 55:a23 56:a24 57:a25 ' +
    '58:a26 59:a27 60:a28 61:a6 62:a7 63:a8 64:a9 65:a10 66:a29 67:a30 68:a31 69:a32 70:a33 71:a34 ' +
    '72:a35 73:a36 74:a37 75:a38 76:a39 77:a40 78:a41 79:a42 80:a43 81:a44 82:a45 83:a46 84:a47 ' +
    '85:a48 86:a49 87:a50 88:a51 89:a52 90:a53 91:a54 92:a55 93:a56 94:a57 95:a58 96:a59 97:a60 ' +
    '98:a61 99:a62 100:a63 101:a64 102:a65 103:a66 104:a67 105:a68 106:a69 107:a70 108:a71 109:a72 ' +
    '110:a73 111:a74 112:a203 113:a75 114:a204 115:a76 116:a77 117:a78 118:a79 119:a81 120:a82 ' +
    '121:a83 122:a84 123:a97 124:a98 125:a99 126:a100 128:a89 129:a90 130:a93 131:a94 132:a91 133:a92 ' +
    '134:a205 135:a85 136:a206 137:a86 138:a87 139:a88 140:a95 141:a96 161:a101 162:a102 163:a103 ' +
    '164:a104 165:a106 166:a107 167:a108 168:a112 169:a111 170:a110 171:a109 172:a120 173:a121 ' +
    '174:a122 175:a123 176:a124 177:a125 178:a126 179:a127 180:a128 181:a129 182:a130 183:a131 ' +
    '184:a132 185:a133 186:a134 187:a135 188:a136 189:a137 190:a138 191:a139 192:a140 193:a141 ' +
    '194:a142 195:a143 196:a144 197:a145 198:a146 199:a147 200:a148 201:a149 202:a150 203:a151 ' +
    '204:a152 205:a153 206:a154 207:a155 208:a156 209:a157 210:a158 211:a159 212:a160 213:a161 ' +
    '214:a163 215:a164 216:a196 217:a165 218:a192 219:a166 220:a167 221:a168 222:a169 223:a170 ' +
    '224:a171 225:a172 226:a173 227:a162 228:a174 229:a175 230:a176 231:a177 232:a178 233:a179 ' +
    '234:a193 235:a180 236:a199 237:a181 238:a200 239:a182 241:a201 242:a183 243:a184 244:a197 ' +
    '245:a185 246:a194 247:a198 248:a186 249:a195 250:a187 251:a188 252:a189 253:a190 254:a191 ',
);

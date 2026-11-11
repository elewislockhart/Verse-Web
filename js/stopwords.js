// Words too common to link verses on: function words and everyday verbs (said, came, went...).
// Words with meaning (Lord, old, pity, man, know, seven...) are NOT here. Edit freely, lowercase.
// Matching is on the exact word as it appears in the text (after lowercasing),
// so list each form you want ignored (e.g. "say", "said", "saith").
(function (root) {
  const WORDS = `
a about above according after again against all almost along already also although always am among an and
another any anything are around as at away

back be became because become becometh been before began begin behind being below beside besides
between beyond both brought but by

came can cannot canst come cometh coming could couldest

did didst do doest doeth does doing done dost doth down during

each either else even ever every

few for forth from further

gave get getteth give given giveth giving go goes goeth going gone got

had hadst has hast hath have having he hence her here hereafter herein hers herself him himself his
how howbeit however

i if in into is it its itself

just

less let lest like likewise

made make maketh making many may me might mine more most much must my myself

namely neither never nevertheless next no none nor not nothing now nought

o of off oft often oh on once one only or other others otherwise ought our ours ourselves out over
own

put

rather

said saith same saw say saying says see seeing seen seeth set shall shalt she should shouldest
since so some something spake speak speaketh such

take taken taketh than that the thee their theirs them themselves then thence there thereby therefore
therein thereof thereon thereto these they thine thing things this thither those thou though through
throughout thus thy thyself till to together too took toward towards

under unless until unto up upon us

very

was wast we went were wert what whatsoever when whence whensoever where whereas whereby wherefore
wherein whereof whereupon wherewith whether which while whilst whither who whoever whom whomsoever
whose whoso whosoever why will wilt with within without would wouldest

ye yea yet you your yours yourself yourselves

behold lo nay concerning pass passed

also again even ever
`;
  const STOPWORDS = new Set(WORDS.split(/\s+/).filter(Boolean));
  if (typeof module !== 'undefined' && module.exports) module.exports = { STOPWORDS };
  else root.STOPWORDS = STOPWORDS;
})(typeof window !== 'undefined' ? window : globalThis);

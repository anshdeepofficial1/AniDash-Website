// Curated episode groups from AniDash Android, not generated arc names.
const groups: Record<string, Array<[string,string,number,number]>> = Object.freeze({
    "21": [
      ["east-blue","East Blue",1,61],["alabasta","Alabasta",62,135],
      ["skypiea","Skypiea",136,206],["davy-back-fight","Davy Back Fight",207,228],
      ["water-seven","Water Seven",229,263],["enies-lobby","Enies Lobby",264,336],
      ["thriller-bark","Thriller Bark",337,381],["summit-war","Summit War",382,516],
      ["fish-man-island","Fish-Man Island",517,574],["dressrosa","Dressrosa",575,746],
      ["four-emperors","Four Emperors",747,1085],["final-saga","Final Saga",1086,9999]
    ],
    "20": [
      ["land-of-waves","Land of Waves",1,19],["chunin-exams","Chunin Exams",20,67],
      ["konoha-crush","Konoha Crush",68,80],["search-for-tsunade","Search for Tsunade",81,106],
      ["sasuke-recovery","Sasuke Recovery",107,135],["anime-original","Anime Original Missions",136,220]
    ],
    "1735": [
      ["kazekage-rescue","Kazekage Rescue",1,32],["tenchi-bridge","Tenchi Bridge",33,53],
      ["akatsuki-suppression","Akatsuki Suppression",54,88],["three-tails","Three-Tails",89,112],
      ["itachi-pursuit","Itachi Pursuit",113,143],["six-tails","Six-Tails",144,151],
      ["pain-assault","Pain's Assault",152,175],["past","Past Arc",176,196],
      ["five-kage-summit","Five Kage Summit",197,221],["war-countdown","Fourth War: Countdown",222,256],
      ["war-confrontation","Fourth War: Confrontation",257,321],
      ["war-climax","Fourth War: Climax",322,375],["ten-tails","Ten-Tails Jinchuriki",376,393],
      ["new-chunin-exams","New Chunin Exams",394,413],["final-battle","Final Battle",414,479],
      ["epilogue","Epilogue",480,500]
    ],
    "269": [
      ["substitute","Substitute Shinigami",1,20],["soul-society","Soul Society",21,63],
      ["bount","Bount",64,109],["arrancar-begins","Arrancar Begins",110,167],
      ["amagi","New Captain Amagai",168,189],["arrancar-battle","Arrancar vs Shinigami",190,229],
      ["zanpakuto","Zanpakuto Rebellion",230,265],["arrancar-fall","Fall of the Arrancar",266,316],
      ["invading-army","Gotei 13 Invading Army",317,342],["lost-agent","The Lost Agent",343,366]
    ],
    "34572": [
      ["entrance","Magic Knights Entrance",1,13],["dungeon","Dungeon Exploration",14,19],
      ["royal-capital","Royal Capital Assault",20,27],["midnight-sun","Eye of the Midnight Sun",28,39],
      ["seabed-temple","Seabed Temple",40,51],["witches-forest","Witches' Forest",52,65],
      ["royal-knights","Royal Knights",66,95],["elf-reincarnation","Elf Reincarnation",96,120],
      ["heart-kingdom","Heart Kingdom",121,157],["spade-kingdom","Spade Kingdom",158,170]
    ],
    "11061": [
      ["hunter-exam","Hunter Exam",1,21],["zoldyck-family","Zoldyck Family",22,26],
      ["heavens-arena","Heavens Arena",27,36],["yorknew-city","Yorknew City",37,58],
      ["greed-island","Greed Island",59,75],["chimera-ant","Chimera Ant",76,136],
      ["election","13th Chairman Election",137,148]
    ]
  });

export type Arc={id:string;title:string;start:number;end:number}
export function getArcs(media:{id:number;idMal?:number},total:number):Arc[]{
 const key=String(media.id);const mal=String(media.idMal||"");const exact=groups[key]||groups[mal==="97940"?"34572":mal];
 if(exact)return exact.filter(g=>g[2]<=total).map(([id,title,start,end])=>({id,title,start,end:Math.min(end,total)}));
 return Array.from({length:Math.ceil(total/100)},(_,i)=>({id:"range-"+i,title:"Episodes "+(i*100+1)+"–"+Math.min((i+1)*100,total),start:i*100+1,end:Math.min((i+1)*100,total)}))
}

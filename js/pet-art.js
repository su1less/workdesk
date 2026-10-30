/* PetArt — official dsh-pet character set (see vendor/pet/SOURCES.txt).
 * mascot.png is a still frame extracted from the official idle clip, so the
 * standing pose and every animation show the same blue twin-tail character.
 * The version query defeats stale image caches after asset swaps. */
const PetArt = {
  VER: '20261030-pet7',
  src: {
    mascot: 'vendor/pet/mascot.png?v=20261030-pet7'
  },
  /* Official dsh-pet action vocabulary → behaviour-chain keys.
   * loop clips (sleep/drag/walk) repeat until the state changes. */
  animations: {
    landing: { src: 'vendor/pet/animations/landing.webm' },            // 原地重力下蹲压缩
    walk: { src: 'vendor/pet/animations/walk.webm', loop: true },      // 螃蟹走路
    idle: { src: 'vendor/pet/animations/idle.webm' },                  // 待机呼吸休闲
    lookAround: { src: 'vendor/pet/animations/look-around.webm' },     // 东张西望
    daze: { src: 'vendor/pet/animations/daze.webm' },                  // 碎碎念-发呆碎碎念
    yawn: { src: 'vendor/pet/animations/yawn.webm' },                  // 哈欠连天
    stretch: { src: 'vendor/pet/animations/stretch.webm' },            // 超大伸懒腰
    sleep: { src: 'vendor/pet/animations/sleep.webm', loop: true },    // 原地小憩沉眠
    wake: { src: 'vendor/pet/animations/wake.webm' },                  // 打瞌睡被惊醒
    drag: { src: 'vendor/pet/animations/drag.webm', loop: true },      // 被鼠标拖拽悬空反馈
    wave: { src: 'vendor/pet/animations/wave.webm' },                  // 点击回应-元气挥手
    happy: { src: 'vendor/pet/animations/happy.webm' },                // 点击回应-开心跃动
    huffy: { src: 'vendor/pet/animations/huffy.webm' }                 // 点击回应-傲娇生气
  },
  image(skin = 'mascot') {
    return `<img class="pet-img" src="${this.src[skin] || this.src.mascot}" alt="" draggable="false">`;
  }
};

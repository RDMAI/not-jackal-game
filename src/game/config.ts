import Phaser from 'phaser';
import { GameScene } from './GameScene';

export function makeGameConfig(): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.CANVAS,
    width: 720,
    height: 720,
    parent: 'game',
    backgroundColor: '#0b1020',
    scene: [GameScene],
  };
}

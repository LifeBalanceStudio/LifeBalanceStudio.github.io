import test from 'node:test';
import assert from 'node:assert/strict';
import { createTVMenu, games } from '../portfolio.mjs';

const canvas = () => ({ width: 768, height: 720, getContext: () => ({ setTransform() {}, save() {}, restore() {}, translate() {}, scale() {}, fillRect() {}, fillText() {}, measureText(text) { return { width: text.length * 8 }; } }) });

test('FastPop 상세의 페이지 전환과 데모를 키보드 및 화면 선택으로 실행한다', () => {
  const played = [];
  const menu = createTVMenu(canvas(), () => {}, games, () => {}, game => played.push(game.title));
  menu.setActive(true);
  menu.choose(); menu.select(1); menu.choose();
  menu.choose();
  assert.equal(menu.detailPage, 1);
  assert.equal(played.length, 0);
  menu.select(1); menu.choose();
  assert.deepEqual(played, ['Fast Pop!!']);
  assert.equal(menu.detailPage, 1);
  assert.equal(menu.detailAction, 1);
  assert.equal(menu.hit(132 / 256, 205 / 240), true);
  assert.equal(played.length, 2);
  menu.hit(132 / 256, 190 / 240);
  assert.equal(menu.detailPage, 0);
  menu.back(); menu.select(-1); menu.choose();
  assert.equal(menu.current.title, 'Uncap');
  assert.equal(menu.hit(132 / 256, 205 / 240), false);
  assert.equal(played.length, 2);
  menu.setActive(false); menu.choose();
  assert.equal(played.length, 2);
});

test('페이지 선택부터 게임 설명까지 세 단계로 이동하고 역순으로 돌아온다', () => {
  const menu = createTVMenu(canvas(), () => {});
  menu.setActive(true);
  assert.equal(menu.stage, 'pages');
  assert.equal(menu.pageCount, 1);
  assert.equal(menu.current, null);
  assert.equal(menu.choose(), true);
  assert.equal(menu.stage, 'games');
  assert.equal(menu.current.title, games[0].title);
  assert.equal(menu.choose(), true);
  assert.equal(menu.stage, 'detail');
  assert.equal(menu.detailPage, 0);
  assert.equal(menu.choose(), true);
  assert.equal(menu.detailPage, 1);
  assert.equal(menu.back(), true);
  assert.equal(menu.stage, 'games');
  menu.select(-1);
  assert.equal(menu.selected, games.length - 1);
  assert.equal(menu.back(), true);
  assert.equal(menu.stage, 'pages');
  assert.equal(menu.back(), false);
});

test('선택한 페이지의 게임만 표시하고 상세 복귀 시 선택 위치를 유지한다', () => {
  const items = Array.from({ length: 21 }, (_, index) => ({ title: '게임 ' + (index + 1), description: '설명 ' + (index + 1) }));
  const menu = createTVMenu(canvas(), () => {}, items);
  menu.setActive(true);
  assert.equal(menu.pageCount, 3);
  menu.select(1);
  menu.choose();
  assert.equal(menu.current.title, '게임 11');
  menu.select(9);
  assert.equal(menu.current.title, '게임 20');
  menu.choose();
  menu.back();
  assert.equal(menu.current.title, '게임 20');
  menu.back();
  assert.equal(menu.selectedPage, 1);
  menu.select(1);
  menu.choose();
  assert.equal(menu.selectableCount, 1);
  assert.equal(menu.current.title, '게임 21');
  menu.select(1);
  assert.equal(menu.current.title, '게임 21');
});

test('TV의 UV 클릭도 페이지와 게임 선택을 거쳐 설명에서 멈춘다', () => {
  const menu = createTVMenu(canvas(), () => {});
  menu.setActive(true);
  menu.hit(0.4, 77 / 240);
  assert.equal(menu.stage, 'games');
  menu.hit(0.4, (49 + 2 * 16 + 5) / 240);
  assert.equal(menu.current.title, 'PachiPachi');
  assert.equal(menu.detail, true);
  assert.equal(menu.choose(), false);
  assert.equal(menu.hit(0.4, 0.4), false);
  menu.setActive(false);
  assert.equal(menu.stage, 'pages');
  assert.equal(menu.choose(), false);
});

test('등록된 게임이 없어도 페이지 화면과 빈 목록에서 오류 없이 돌아온다', () => {
  const menu = createTVMenu(canvas(), () => {}, []);
  menu.setActive(true);
  menu.choose();
  assert.equal(menu.current, null);
  assert.equal(menu.selectableCount, 0);
  assert.equal(menu.choose(), false);
  menu.select(1);
  assert.equal(menu.back(), true);
});

test('소개와 특징은 같은 게임 안에서 전환하고 목록 복귀 후 소개부터 다시 표시한다', () => {
  const menu = createTVMenu(canvas(), () => {});
  menu.setActive(true);
  assert.equal(menu.turnDetail(1), false);
  menu.choose();
  menu.choose();
  assert.equal(menu.detailPageCount, 2);
  assert.match(menu.detailText, /1인 개발/);
  assert.match(menu.detailText, /2025.08.05/);
  assert.equal(menu.turnDetail(1), true);
  assert.equal(menu.current.title, 'Uncap');
  assert.equal(menu.detailTitle, '개발 특징');
  assert.match(menu.detailText, /드래그 입력 대상 고정/);
  menu.select(100);
  assert.equal(menu.detailPage, 1);
  menu.back();
  assert.equal(menu.stage, 'games');
  assert.equal(menu.current.title, 'Uncap');
  menu.choose();
  assert.equal(menu.detailPage, 0);
  menu.turnDetail(-1);
  assert.equal(menu.detailPage, 1);
  menu.setActive(false);
  assert.equal(menu.turnDetail(1), false);
  assert.equal(menu.detailPage, 0);
});

test('CRT의 전환 버튼만 클릭을 처리하며 개발 특징이 없는 게임에는 빈 두 번째 화면을 만들지 않는다', () => {
  const menu = createTVMenu(canvas(), () => {});
  menu.setActive(true);
  menu.choose();
  menu.choose();
  assert.equal(menu.hit(0.5, 0.5), false);
  assert.equal(menu.hit(132 / 256, 195 / 240), true);
  assert.equal(menu.detailPage, 1);
  assert.equal(menu.hit(132 / 256, 195 / 240), true);
  assert.equal(menu.detailPage, 0);
  menu.back();
  menu.select(1);
  menu.choose();
  assert.equal(menu.current.title, 'Fast Pop!!');
  assert.equal(menu.detailPage, 0);
  assert.equal(menu.detailPageCount, 2);
  assert.match(menu.detailText, /2025.09.01~2025.10.22/);
  assert.equal(menu.turnDetail(1), true);
  assert.match(menu.detailText, /피버·황금 러시/);
  assert.doesNotMatch(menu.detailText, /드래그 입력 대상/);
  menu.back();
  menu.select(1);
  menu.choose();
  assert.equal(menu.current.title, 'PachiPachi');
  assert.equal(menu.detailPageCount, 1);
  assert.equal(menu.turnDetail(1), false);
  assert.equal(menu.choose(), false);
  assert.equal(menu.hit(132 / 256, 195 / 240), false);
});

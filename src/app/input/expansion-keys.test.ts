import {expect,it} from 'vitest';
import {mapKey} from './keyboard';
it('maps ranged fire and nearby interaction keys', () => {
  expect(mapKey('f')).toEqual({kind:'command',cmd:'fire'});
  expect(mapKey('t')).toEqual({kind:'command',cmd:'interact'});
});

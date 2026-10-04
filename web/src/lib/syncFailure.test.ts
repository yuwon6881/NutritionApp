import {describe,expect,it} from 'vitest';
import {ApiError} from './api';
import {classifySyncFailure} from './syncFailure';

describe('diary sync failure handling',()=>{
  it.each([400,409,422])('drops an edit the server terminally rejected with %i',status=>{
    expect(classifySyncFailure(new ApiError('Rejected',status))).toBe('rejected');
  });
  it('stops sending, rather than retrying forever, when the session has expired',()=>{
    expect(classifySyncFailure(new ApiError('Your session expired.',401))).toBe('session-expired');
  });
  it.each([
    ['rate limit',new ApiError('Busy',429,1000)],
    ['server error',new ApiError('Unavailable',503)],
    ['network failure',new TypeError('Failed to fetch')],
  ])('retries after a %s',(_label,ex)=>{
    expect(classifySyncFailure(ex)).toBe('retry');
  });
});

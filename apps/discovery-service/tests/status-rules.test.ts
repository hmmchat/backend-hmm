import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAcceptanceTimeoutStatus,
  resolveRaincheckPartnerStatus,
  resolveRoomEndParticipantStatus
} from '../src/status/status-rules.js';

test('resolveAcceptanceTimeoutStatus keeps accepter AVAILABLE', () => {
  const acceptedBy = new Set(['user-a']);
  assert.equal(resolveAcceptanceTimeoutStatus('user-a', acceptedBy, false), 'AVAILABLE');
});

test('resolveAcceptanceTimeoutStatus demotes passive user without session to ONLINE', () => {
  const acceptedBy = new Set(['user-a']);
  assert.equal(resolveAcceptanceTimeoutStatus('user-b', acceptedBy, false), 'ONLINE');
});

test('resolveAcceptanceTimeoutStatus keeps passive user with active session AVAILABLE', () => {
  const acceptedBy = new Set<string>();
  assert.equal(resolveAcceptanceTimeoutStatus('user-b', acceptedBy, true), 'AVAILABLE');
});

test('resolveRaincheckPartnerStatus returns ONLINE when no discovery session', () => {
  assert.equal(resolveRaincheckPartnerStatus(false), 'ONLINE');
});

test('resolveRaincheckPartnerStatus returns AVAILABLE when discovery session active', () => {
  assert.equal(resolveRaincheckPartnerStatus(true), 'AVAILABLE');
});

test('resolveRoomEndParticipantStatus preserves AVAILABLE current status', () => {
  assert.equal(resolveRoomEndParticipantStatus('IN_SQUAD', 'AVAILABLE'), 'AVAILABLE');
});

test('resolveRoomEndParticipantStatus never restores MATCHED', () => {
  assert.equal(resolveRoomEndParticipantStatus('MATCHED', 'IN_SQUAD'), 'ONLINE');
});

test('resolveRoomEndParticipantStatus restores previous non-matched status', () => {
  assert.equal(resolveRoomEndParticipantStatus('IN_SQUAD', 'IN_SQUAD'), 'IN_SQUAD');
});

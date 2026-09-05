import type { Driver } from '../engine/types.js';
import { dataDriver } from '../engine/data.js';

export const viewDriver: Driver = dataDriver;

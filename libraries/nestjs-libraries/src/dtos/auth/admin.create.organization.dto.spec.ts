import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AdminCreateOrganizationDto } from './admin.create.organization.dto';

describe('AdminCreateOrganizationDto', () => {
  it.each([
    ['1234567', ['password']],
    ['12345678', []],
  ])('validates the initial password boundary', async (password, fields) => {
    const input = Object.assign(new AdminCreateOrganizationDto(), {
      company: 'Example Organization',
      email: 'owner@example.test',
      password,
    });

    expect((await validate(input)).map(({ property }) => property)).toEqual(fields);
  });
});

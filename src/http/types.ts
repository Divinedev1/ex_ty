export type PetParams = {
    id: string,
}

export type PetQueryParams = {
    species?: string | string[],
    adopted?: string | string[],
    limit?: string | string[],
    offset?: string | string[],
    password?: string | string[],
}
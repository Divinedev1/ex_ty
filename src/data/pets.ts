export type PetMedicalRecords = {
    vaccinations: string[],
    weightKg: number,
    microchipId: string | null
}

export type Pet = {
    id: number,
    name: string,
    species: string,
    breed: string,
    age: number,
    adopted: boolean,
    intakeDate: Date,
    adoptionDate?: Date,
    medicalRecords: PetMedicalRecords,
    photo: string,
}

export type PetRow = {
    id: number,
    name: string,
    species: string,
    breed: string,
    age: number,
    adopted: boolean,
    intake_date: Date,
    adoption_date: Date | null,
    photo: string,
    vaccinations: string[] | null,
    weight_kg: string | null,
    microchip_id: string | null,
    total_count?: string,
}
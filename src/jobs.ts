export interface Job {

}

export class UploadJob implements Job {
    private _location: string;
    constructor(location: string) {
        this._location = location;
    }
}

export class LoadFromJob implements Job {
    private _location: string;
    constructor(location: string) {
        this._location = location;
    }
}